// Auto-przydział miejsc na sali (planer) i jego wejście z danych panelu.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Zespół zapisu grupowego ląduje w trzech różnych rzędach, choć obok był
//      wolny odcinek - najczęstsza skarga po gali.
//   2. Osoba firmy, dla której trzymamy stół, siada na sali ogólnej, a jej stół
//      zostaje pusty.
//   3. Planer sadza bilet standard w kategorii VIP (baza i tak odrzuci, ale
//      organizator zobaczy w podglądzie propozycję, której nie da się zapisać).
//   4. Ta sama lista daje inny wynik po odświeżeniu (brak determinizmu).
import { describe, expect, it } from "vitest";

import {
  categoryTicketsOf,
  companyKeyOf,
  planSeating,
  plannerCandidatesFromRows,
  plannerSeatsFromDetail,
  type PlannerCandidate,
  type PlannerOptions,
  type PlannerSeat,
} from "@/lib/events/seatingPlanner";
import { seatingCandidate, seatMapDetail, seat as seatFixture } from "@/test/events/seatingFixtures";

function seat(id: string, sortKey: number, overrides: Partial<PlannerSeat> = {}): PlannerSeat {
  return {
    id,
    sectionId: "A",
    sectionOrder: 0,
    sortKey,
    status: "available",
    categoryId: null,
    holdCompanyId: null,
    holdPackageOrderId: null,
    occupied: false,
    ...overrides,
  };
}

function person(id: string, overrides: Partial<PlannerCandidate> = {}): PlannerCandidate {
  return {
    registrationId: id,
    partyKey: id,
    companyKey: null,
    companyId: null,
    packageOrderId: null,
    ticketTypeId: "t-std",
    seated: false,
    ...overrides,
  };
}

const OPTIONS: PlannerOptions = {
  categoryTickets: {},
  keepTogether: true,
  holdsFirst: true,
  ticketTypeIds: null,
};

describe("klucz firmy", () => {
  it("identyfikator CRM wygrywa, tekst jest normalizowany, pustka = brak", () => {
    expect(companyKeyOf("co-1", "cokolwiek")).toBe("id:co-1");
    expect(companyKeyOf(null, "  Orlen   SA ")).toBe("text:orlen sa");
    expect(companyKeyOf(null, "   ")).toBeNull();
    expect(companyKeyOf(null, null)).toBeNull();
  });
});

describe("planer: kolejność, blokady, zajęte", () => {
  it("wypełnia od przodu, pomija zablokowane i zajęte, rezerwacje innych są nietykalne", () => {
    const result = planSeating(
      [
        seat("s3", 2),
        seat("s1", 0, { status: "blocked" }),
        seat("s2", 1, { occupied: true }),
        seat("s4", 3, { status: "held", holdCompanyId: "inna" }),
        seat("s5", 4),
      ],
      [person("r1"), person("r2"), person("r3")],
      OPTIONS,
    );
    expect(result.proposals).toEqual([
      { seatId: "s3", registrationId: "r1" },
      { seatId: "s5", registrationId: "r2" },
    ]);
    expect(result.unplaced).toEqual([{ registrationId: "r3", reason: "no_seat" }]);
  });

  it("jest deterministyczny: ten sam wynik bez względu na kolejność wejścia", () => {
    const seats = [seat("b", 0, { sectionId: "B" }), seat("a", 0), seat("c", 1)];
    const people = [person("r2"), person("r1")];
    const first = planSeating(seats, people, OPTIONS);
    const second = planSeating([...seats].reverse(), [...people].reverse(), OPTIONS);
    expect(second).toEqual(first);
    // Remis kolejności sekcji i sort_key rozstrzyga identyfikator miejsca.
    expect(first.proposals[0].seatId).toBe("a");
  });

  it("pomija osoby, które już siedzą, i ogranicza do wybranych biletów", () => {
    const result = planSeating(
      [seat("s1", 0), seat("s2", 1)],
      [
        person("r1", { seated: true }),
        person("r2", { ticketTypeId: "t-vip" }),
        person("r3", { ticketTypeId: null }),
        person("r4"),
      ],
      { ...OPTIONS, ticketTypeIds: ["t-std"] },
    );
    expect(result.proposals).toEqual([{ seatId: "s1", registrationId: "r4" }]);
    expect(result.unplaced).toEqual([]);
  });
});

describe("planer: kategorie i bilety", () => {
  it("kategoria z listą biletów przyjmuje tylko te bilety; bez listy - każdy", () => {
    const seats = [
      seat("vip", 0, { categoryId: "cat-vip" }),
      seat("open", 1, { categoryId: "cat-open" }),
      seat("unknown", 2, { categoryId: "cat-nieznana" }),
    ];
    const result = planSeating(
      seats,
      [person("std"), person("vip", { ticketTypeId: "t-vip" }), person("nul", { ticketTypeId: null }), person("x")],
      { ...OPTIONS, keepTogether: false, categoryTickets: { "cat-vip": ["t-vip"], "cat-open": [] } },
    );
    expect(result.proposals).toEqual([
      { seatId: "open", registrationId: "nul" },
      { seatId: "unknown", registrationId: "std" },
      { seatId: "vip", registrationId: "vip" },
    ]);
    expect(result.unplaced).toEqual([{ registrationId: "x", reason: "no_seat" }]);
  });

  it("brak jakiegokolwiek miejsca dopuszczającego bilet = powód no_allowed_seat", () => {
    const result = planSeating([seat("vip", 0, { categoryId: "cat-vip" })], [person("std")], {
      ...OPTIONS,
      categoryTickets: { "cat-vip": ["t-vip"] },
    });
    expect(result.unplaced).toEqual([{ registrationId: "std", reason: "no_allowed_seat" }]);
  });
});

describe("planer: rezerwacje i zespoły", () => {
  it("osoby firmy i pakietu siadają najpierw w swoich blokach", () => {
    const seats = [
      seat("free", 0),
      seat("co", 1, { status: "held", holdCompanyId: "co-1" }),
      seat("pkg", 2, { status: "held", holdPackageOrderId: "po-1" }),
    ];
    const people = [
      person("firma", { companyId: "co-1", companyKey: "id:co-1" }),
      person("pakiet", { packageOrderId: "po-1" }),
    ];
    const first = planSeating(seats, people, OPTIONS);
    expect(first.proposals).toEqual(
      expect.arrayContaining([
        { seatId: "co", registrationId: "firma" },
        { seatId: "pkg", registrationId: "pakiet" },
      ]),
    );
    // Bez "najpierw rezerwacje" siadają na sali ogólnej, a bloki zostają puste.
    const second = planSeating(seats, people, { ...OPTIONS, holdsFirst: false });
    expect(second.proposals.map((entry) => entry.seatId)).toEqual(["free"]);
    expect(second.unplaced).toHaveLength(1);
  });

  it("zespół dostaje ciągły odcinek w jednym rzędzie, a nie rozproszone miejsca", () => {
    const seats = [
      seat("r0p0", 0),
      seat("r0p1", 1, { occupied: true }),
      seat("r0p2", 2),
      seat("r1p0", 1000),
      seat("r1p1", 1001),
      seat("r1p2", 1002),
    ];
    const party = [person("lead"), person("guest1", { partyKey: "lead" }), person("guest2", { partyKey: "lead" })];
    const result = planSeating(seats, party, OPTIONS);
    expect(result.proposals.map((entry) => entry.seatId)).toEqual(["r1p0", "r1p1", "r1p2"]);
  });

  it("odcinek nie przechodzi przez granicę rzędu ani przez kategorię spoza biletu", () => {
    const seats = [
      seat("r0p0", 0),
      seat("r0p1", 1, { categoryId: "cat-vip" }),
      seat("r0p2", 2),
      seat("r1p0", 1000),
    ];
    const party = [person("lead"), person("g", { partyKey: "lead" })];
    const result = planSeating(seats, party, { ...OPTIONS, categoryTickets: { "cat-vip": ["t-vip"] } });
    // Brak odcinka dla dwóch osób - siadają pojedynczo od przodu.
    expect(result.proposals).toEqual([
      { seatId: "r0p0", registrationId: "lead" },
      { seatId: "r0p2", registrationId: "g" },
    ]);
  });

  it("bez „grupy razem” każda osoba jest osobnym zespołem; firmy przed osobami bez firmy", () => {
    const people = [
      person("zz-bez-firmy"),
      person("b-firma", { companyKey: "text:b", partyKey: "x" }),
      person("a-firma", { companyKey: "text:a", partyKey: "x" }),
      person("aa-bez", { partyKey: "y" }),
    ];
    const result = planSeating(
      [seat("s1", 0), seat("s2", 1), seat("s3", 2), seat("s4", 3)],
      people,
      { ...OPTIONS, keepTogether: false },
    );
    expect(result.proposals.map((entry) => entry.registrationId)).toEqual([
      "a-firma",
      "b-firma",
      "aa-bez",
      "zz-bez-firmy",
    ]);
  });
});

describe("wejście planera z danych panelu", () => {
  it("miejsca: kategoria efektywna, firma sponsora, zajętość z przydziałów", () => {
    const detail = seatMapDetail();
    detail.seats.push(
      seatFixture({ id: "seat-sp", sectionId: "sec-t", sortKey: 2, status: "held", holdSponsorId: "sp-1" }),
      seatFixture({ id: "seat-sp2", sectionId: "sec-t", sortKey: 3, status: "held", holdSponsorId: "sp-x" }),
      seatFixture({ id: "seat-orphan", sectionId: "sec-brak", sortKey: 0 }),
    );
    detail.seats[0] = { ...detail.seats[0], categoryId: "cat-own" };
    const seats = plannerSeatsFromDetail(detail, new Map([["sp-1", "co-sponsor"]]));
    const byId = new Map(seats.map((entry) => [entry.id, entry]));
    expect(byId.get("seat-a1")?.categoryId).toBe("cat-own");
    expect(byId.get("seat-a2")).toMatchObject({ categoryId: "cat-vip", occupied: true, sectionOrder: 0 });
    expect(byId.get("seat-t1")).toMatchObject({ holdCompanyId: "co-1", sectionOrder: 1, categoryId: null });
    expect(byId.get("seat-sp")?.holdCompanyId).toBe("co-sponsor");
    expect(byId.get("seat-sp2")?.holdCompanyId).toBeNull();
    // Miejsce bez sekcji w planie nie trafia do planera.
    expect(byId.has("seat-orphan")).toBe(false);
  });

  it("kandydaci: klucz firmy, pakiet, bilet i to, czy już siedzą", () => {
    expect(
      plannerCandidatesFromRows([
        seatingCandidate(),
        seatingCandidate({
          registration_id: "reg-2",
          company_id: null,
          company: "Wolny Tekst",
          package_order_id: "po-1",
          seat_id: "seat-a2",
          ticket_type_id: null,
          party_key: "reg-1",
        }),
      ]),
    ).toEqual([
      {
        registrationId: "reg-1",
        partyKey: "reg-1",
        companyKey: "id:co-1",
        companyId: "co-1",
        packageOrderId: null,
        ticketTypeId: "t-vip",
        seated: false,
      },
      {
        registrationId: "reg-2",
        partyKey: "reg-1",
        companyKey: "text:wolny tekst",
        companyId: null,
        packageOrderId: "po-1",
        ticketTypeId: null,
        seated: true,
      },
    ]);
  });

  it("kategorie: mapa kategoria -> dozwolone bilety", () => {
    expect(categoryTicketsOf(seatMapDetail())).toEqual({ "cat-vip": ["t-vip"] });
  });
});
