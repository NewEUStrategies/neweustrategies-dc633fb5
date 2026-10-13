import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DZIEN, freezeClock, relativeIso } from "@/test/time";

// Atrapa klienta: `from().select().contains().order()` oddaje kolejne
// odpowiedzi z kolejki i zapisuje, o jakie kolumny pytano.
const sb = vi.hoisted(() => ({
  selects: [] as string[],
  responses: [] as Array<{ data: unknown; error: { code?: string; message?: string } | null }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        sb.selects.push(columns);
        const chain = {
          contains: () => chain,
          order: async () => sb.responses.shift() ?? { data: [], error: null },
        };
        return chain;
      },
    }),
  },
}));

import {
  emptyEventCodeDraft,
  eventCodeDraftIssue,
  eventCodeDraftToPayload,
  eventCodeRegistrationUrl,
  eventCodeRowToDraft,
  eventCodeStatus,
  fetchEventCodes,
  type EventCodeRow,
} from "@/lib/events/eventCodesApi";
import { eventLocalInput } from "@/lib/events/eventLocalInput";

const base = () => ({
  ...emptyEventCodeDraft("PLN", "Europe/Warsaw"),
  code: "vip10",
  amount: "10",
});

// `eventCodeStatus` czyta domyślnie prawdziwy zegar, więc plik zamraża
// „teraz", a daty ważności kodu liczy względem niego.
freezeClock();

describe("eventCodeDraftIssue", () => {
  it("accepts a valid percent code", () => {
    expect(eventCodeDraftIssue(base())).toBeNull();
  });
  it("requires a code", () => {
    expect(eventCodeDraftIssue({ ...base(), code: " " })).toBe("code");
  });
  it("requires an effect", () => {
    expect(eventCodeDraftIssue({ ...base(), appliesDiscount: false })).toBe("noEffect");
    expect(
      eventCodeDraftIssue({ ...base(), appliesDiscount: false, revealsHidden: true }),
    ).toBeNull();
  });
  it("validates percent and amount", () => {
    expect(eventCodeDraftIssue({ ...base(), amount: "101" })).toBe("percent");
    expect(eventCodeDraftIssue({ ...base(), discountKind: "fixed", amount: "0" })).toBe("amount");
  });
  it("validates quantity, dates and tickets", () => {
    expect(eventCodeDraftIssue({ ...base(), quantity: "0" })).toBe("quantity");
    // Pola to zegar `datetime-local` w strefie wydarzenia (F12/F15) - nie ISO.
    const field = (offset: number) => eventLocalInput(relativeIso(offset), "Europe/Warsaw");
    expect(
      eventCodeDraftIssue({
        ...base(),
        validFrom: field(10 * DZIEN),
        validUntil: field(9 * DZIEN),
      }),
    ).toBe("dates");
    expect(eventCodeDraftIssue({ ...base(), ticketScope: "specific" })).toBe("tickets");
  });
});

describe("eventCodeDraftToPayload", () => {
  it("scopes the code to the event and normalizes it", () => {
    const p = eventCodeDraftToPayload("ev1", { ...base(), discountKind: "fixed", amount: "19,99" });
    expect(p.code).toBe("VIP10");
    expect(p.event_ids).toEqual(["ev1"]);
    expect(p.discount_cents).toBe(1999);
    expect(p.discount_percent).toBeNull();
    expect(p.ticket_type_ids).toEqual([]);
  });
  it("reveal-only code carries no discount", () => {
    const p = eventCodeDraftToPayload("ev1", {
      ...base(),
      appliesDiscount: false,
      revealsHidden: true,
    });
    expect(p.discount_percent).toBeNull();
    expect(p.discount_cents).toBeNull();
    expect(p.applies_discount).toBe(false);
  });
});

describe("status, url, round trip", () => {
  const row: EventCodeRow = {
    id: "c1",
    code: "VIP10",
    name: null,
    description: null,
    active: true,
    appliesDiscount: true,
    revealsHidden: false,
    discountKind: "percent",
    discountPercent: 10,
    discountCents: null,
    currency: null,
    maxRedemptions: 2,
    redemptionsCount: 2,
    validFrom: null,
    validUntil: null,
    ticketTypeIds: ["t1"],
    stacking: null,
  };
  it("computes status", () => {
    expect(eventCodeStatus(row)).toBe("used_up");
    expect(eventCodeStatus({ ...row, active: false })).toBe("inactive");
    expect(eventCodeStatus({ ...row, maxRedemptions: null })).toBe("active");
  });
  it("builds the registration URL", () => {
    expect(eventCodeRegistrationUrl("https://neweuropeanstrategies.com", "summit", "VIP 10")).toBe(
      "https://neweuropeanstrategies.com/events/summit/register?code=VIP%2010",
    );
  });
  it("row to draft keeps scope", () => {
    const d = eventCodeRowToDraft(row, "Europe/Warsaw");
    expect(d.ticketScope).toBe("specific");
    expect(d.amount).toBe("10");
  });
});

// TIX-10. Pole `datetime-local` mówi zegarem, baza - UTC. Szkic brał dotąd
// pierwsze 16 znaków napisu UTC, a zapis czytał je jako czas lokalny:
// w Warszawie latem każda edycja cofała okno ważności o 2 godziny.
//
// Po OPS-15 (F12/F15) zegarem pola jest STREFA WYDARZENIA, nie przeglądarki,
// więc te same przypadki biegną dla wydarzenia w Warszawie oglądanego
// z przeglądarki w Nowym Jorku - wynik nie może zależeć od laptopa organizatora.
describe("okno ważności kodu w strefie Europe/Warsaw (TIX-10)", () => {
  const STREFA = "Europe/Warsaw";
  let previousTz: string | undefined;
  beforeAll(() => {
    previousTz = process.env.TZ;
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  const withWindow = (validFrom: string | null, validUntil: string | null): EventCodeRow => ({
    id: "c1",
    code: "LATO",
    name: null,
    description: null,
    active: true,
    appliesDiscount: true,
    revealsHidden: false,
    discountKind: "percent",
    discountPercent: 10,
    discountCents: null,
    currency: null,
    maxRedemptions: null,
    redemptionsCount: 0,
    validFrom,
    validUntil,
    ticketTypeIds: [],
    stacking: null,
  });

  it("pole pokazuje czas warszawski: latem UTC+2, zimą UTC+1", () => {
    const draft = eventCodeRowToDraft(
      withWindow("2099-06-15T12:00:00.000Z", "2099-01-16T12:00:00.000Z"),
      STREFA,
    );
    expect(draft.validFrom).toBe("2099-06-15T14:00");
    expect(draft.validUntil).toBe("2099-01-16T13:00");
  });

  it("zapis bez zmian oddaje bazie dokładnie tę samą chwilę", () => {
    const row = withWindow("2099-06-15T12:00:00.000Z", "2099-06-30T21:59:00.000Z");
    const payload = eventCodeDraftToPayload("ev1", eventCodeRowToDraft(row, STREFA));
    expect(payload.valid_from).toBe("2099-06-15T12:00:00.000Z");
    expect(payload.valid_until).toBe("2099-06-30T21:59:00.000Z");
  });

  it("kolejne edycje nie przesuwają okna (brak dryfu)", () => {
    let row = withWindow("2099-03-29T00:30:00.000Z", "2099-10-25T00:30:00.000Z");
    for (let edit = 0; edit < 3; edit += 1) {
      const payload = eventCodeDraftToPayload("ev1", eventCodeRowToDraft(row, STREFA));
      row = { ...row, validFrom: payload.valid_from, validUntil: payload.valid_until };
    }
    expect(row.validFrom).toBe("2099-03-29T00:30:00.000Z");
    expect(row.validUntil).toBe("2099-10-25T00:30:00.000Z");
  });

  it("wpis redaktora „30.06, 23:59” to 21:59 UTC latem", () => {
    const payload = eventCodeDraftToPayload("ev1", {
      ...base(),
      validFrom: "2099-06-01T00:00",
      validUntil: "2099-06-30T23:59",
    });
    expect(payload.valid_from).toBe("2099-05-31T22:00:00.000Z");
    expect(payload.valid_until).toBe("2099-06-30T21:59:00.000Z");
  });

  it("puste albo niepełne pole to brak granicy, a nie „Invalid Date”", () => {
    const payload = eventCodeDraftToPayload("ev1", { ...base(), validFrom: "", validUntil: "" });
    expect(payload.valid_from).toBeNull();
    expect(payload.valid_until).toBeNull();
  });
});

// TIX-13a. Kod niesie regułę kumulacji z innymi promocjami biletu.
describe("reguła kumulacji kodu (TIX-13a)", () => {
  it("nowy kod: łączy się, bez limitu; baza bez kolumn - bez reguły", () => {
    expect(emptyEventCodeDraft("PLN", "Europe/Warsaw").stacking).toEqual({
      stacksWithPromotions: true,
      maxTotalDiscountPercent: "",
    });
    expect(emptyEventCodeDraft("PLN", "Europe/Warsaw", false).stacking).toBeNull();
  });

  it("limit łącznego rabatu: puste albo liczba całkowita 1-100", () => {
    const withCap = (value: string) => ({
      ...base(),
      stacking: { stacksWithPromotions: true, maxTotalDiscountPercent: value },
    });
    for (const ok of ["", " ", "1", "50", "100"]) {
      expect(eventCodeDraftIssue(withCap(ok)), ok).toBeNull();
    }
    for (const bad of ["0", "101", "12.5", "12,5", "-5", "abc"]) {
      expect(eventCodeDraftIssue(withCap(bad)), bad).toBe("maxTotal");
    }
  });

  it("baza zna regułę - ładunek niesie ją ZAWSZE, także wartości domyślne", () => {
    const def = eventCodeDraftToPayload("ev1", base());
    expect(def).toMatchObject({ stacks_with_promotions: true, max_total_discount_percent: null });
    const strict = eventCodeDraftToPayload("ev1", {
      ...base(),
      stacking: { stacksWithPromotions: false, maxTotalDiscountPercent: " 40 " },
    });
    expect(strict).toMatchObject({ stacks_with_promotions: false, max_total_discount_percent: 40 });
  });

  it("baza bez kolumn - ładunek nie ma kluczy reguły (zapis nie padnie)", () => {
    const payload = eventCodeDraftToPayload("ev1", { ...base(), stacking: null });
    expect(payload).not.toHaveProperty("stacks_with_promotions");
    expect(payload).not.toHaveProperty("max_total_discount_percent");
  });

  it("wiersz -> szkic przenosi regułę", () => {
    const draft = eventCodeRowToDraft(
      {
        id: "c1",
        code: "PRASA",
        name: null,
        description: null,
        active: true,
        appliesDiscount: true,
        revealsHidden: false,
        discountKind: "percent",
        discountPercent: 100,
        discountCents: null,
        currency: null,
        maxRedemptions: null,
        redemptionsCount: 0,
        validFrom: null,
        validUntil: null,
        ticketTypeIds: [],
        stacking: { stacksWithPromotions: false, maxTotalDiscountPercent: 60 },
      },
      "Europe/Warsaw",
    );
    expect(draft.stacking).toEqual({ stacksWithPromotions: false, maxTotalDiscountPercent: "60" });
  });
});

describe("fetchEventCodes - lista z regułą kumulacji", () => {
  beforeEach(() => {
    sb.selects = [];
    sb.responses = [];
  });

  const dbRow = {
    id: "c1",
    code: "VIP10",
    name: null,
    description: null,
    active: true,
    applies_discount: true,
    reveals_hidden: false,
    discount_kind: "percent",
    discount_percent: 10,
    discount_cents: null,
    currency: null,
    max_redemptions: null,
    redemptions_count: 0,
    valid_from: null,
    valid_until: null,
    ticket_type_ids: [],
  };

  it("jedno zapytanie z kolumnami reguły; limit spoza 1-100 to brak limitu", async () => {
    sb.responses.push({
      data: [
        { ...dbRow, stacks_with_promotions: false, max_total_discount_percent: 30 },
        { ...dbRow, id: "c2", stacks_with_promotions: true, max_total_discount_percent: 0 },
      ],
      error: null,
    });
    const list = await fetchEventCodes("ev1");
    expect(sb.selects).toHaveLength(1);
    expect(sb.selects[0]).toContain("stacks_with_promotions");
    expect(list.stackingAvailable).toBe(true);
    expect(list.rows.map((r) => r.stacking)).toEqual([
      { stacksWithPromotions: false, maxTotalDiscountPercent: 30 },
      { stacksWithPromotions: true, maxTotalDiscountPercent: null },
    ]);
  });

  it("baza przed migracją (42703) - drugie zapytanie bez kolumn reguły", async () => {
    sb.responses.push({ data: null, error: { code: "42703", message: "column does not exist" } });
    sb.responses.push({ data: [dbRow], error: null });
    const list = await fetchEventCodes("ev1");
    expect(sb.selects).toHaveLength(2);
    expect(sb.selects[1]).not.toContain("stacks_with_promotions");
    expect(list.stackingAvailable).toBe(false);
    expect(list.rows[0]?.stacking).toBeNull();
  });

  it("inny błąd odczytu RZUCA - lista nie udaje pustej", async () => {
    sb.responses.push({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(fetchEventCodes("ev1")).rejects.toMatchObject({ code: "42501" });
    expect(sb.selects).toHaveLength(1);
  });
});
