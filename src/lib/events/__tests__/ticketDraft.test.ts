// Szkic biletu: konwersje i warunki, które baza sprawdza CHECK-iem.
//
// Testy celują w te przypadki, w których błąd jest CICHY: puste pole puli
// zamienione na zero (bilet natychmiast wyprzedany), pusta data zamieniona na
// „1970" i cena wpisana z przecinkiem, która po `Number()` staje się `NaN`.
import { describe, expect, it } from "vitest";
import {
  emptyTicketDraft,
  fromLocalInput,
  ticketDraftFromRow,
  ticketDraftIssue,
  ticketDraftToInput,
  toLocalInput,
  type TicketDraft,
} from "@/lib/events/ticketDraft";
import type { EventTicketRow } from "@/lib/events/registrationsApi";

function valid(overrides: Partial<TicketDraft> = {}): TicketDraft {
  return {
    ...emptyTicketDraft(10),
    key: "vip_pass",
    namePl: "Karnet VIP",
    nameEn: "VIP pass",
    priceCents: "15000",
    ...overrides,
  };
}

describe("ticketDraftIssue", () => {
  it("poprawny szkic przechodzi", () => {
    expect(ticketDraftIssue(valid())).toBeNull();
  });

  it("klucz jest sprawdzany tylko przy tworzeniu", () => {
    expect(ticketDraftIssue(valid({ key: "VIP PASS" }))?.field).toBe("key");
    // Przy edycji klucza nie wysyłamy wcale, więc jego treść nie może blokować
    // zapisu nazwy - inaczej starych biletów nie da się już poprawić.
    expect(ticketDraftIssue(valid({ id: "t-1", key: "LEGACY KEY" }))).toBeNull();
  });

  it("nazwa jest wymagana w obu językach", () => {
    expect(ticketDraftIssue(valid({ namePl: "  " }))).toEqual({
      field: "namePl",
      errorKey: "invalidNames",
    });
    expect(ticketDraftIssue(valid({ nameEn: "" }))?.field).toBe("nameEn");
  });

  it("cena z przecinkiem, minusem albo literą jest odrzucana przed żądaniem", () => {
    for (const priceCents of ["150,00", "150.00", "-1", "abc", ""]) {
      expect(ticketDraftIssue(valid({ priceCents }))?.field, priceCents).toBe("priceCents");
    }
    expect(ticketDraftIssue(valid({ priceCents: "0" }))).toBeNull();
  });

  it("pusta pula jest dopuszczalna (bez limitu), ujemna nie", () => {
    expect(ticketDraftIssue(valid({ quota: "" }))).toBeNull();
    expect(ticketDraftIssue(valid({ quota: "-3" }))?.field).toBe("quota");
    expect(ticketDraftIssue(valid({ quota: "1.5" }))?.field).toBe("quota");
  });

  it("okno sprzedaży zamknięte przed otwarciem nie przechodzi", () => {
    const issue = ticketDraftIssue(
      valid({ salesFrom: "2026-09-01T10:00", salesTo: "2026-08-31T10:00" }),
    );
    expect(issue?.field).toBe("salesTo");
    // Jedna granica bez drugiej jest poprawna - to sprzedaż otwarta w jedną stronę.
    expect(ticketDraftIssue(valid({ salesFrom: "2026-09-01T10:00" }))).toBeNull();
    expect(ticketDraftIssue(valid({ salesTo: "2026-09-01T10:00" }))).toBeNull();
  });
});

describe("ticketDraftToInput", () => {
  it("pusta pula i puste daty idą jako null, nie jako zero i 1970", () => {
    const input = ticketDraftToInput(valid({ quota: "", salesFrom: "", salesTo: "" }), "e-1");
    expect(input.quota).toBeNull();
    expect(input.salesFrom).toBeNull();
    expect(input.salesTo).toBeNull();
    expect(input.priceCents).toBe(15000);
    expect(input.eventId).toBe("e-1");
  });

  it("pula zero zostaje zerem - to bilet wyprzedany, nie bilet bez limitu", () => {
    expect(ticketDraftToInput(valid({ quota: "0" }), "e-1").quota).toBe(0);
  });

  it("obcina białe znaki w nazwach i kluczu", () => {
    const input = ticketDraftToInput(valid({ key: " vip_pass ", namePl: " Karnet " }), "e-1");
    expect(input.key).toBe("vip_pass");
    expect(input.namePl).toBe("Karnet");
  });
});

describe("konwersja daty", () => {
  it("puste i niepoprawne wejście daje null", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("   ")).toBeNull();
    expect(fromLocalInput("2026-13-45T99:99")).toBeNull();
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("nonsense")).toBe("");
  });

  it("ISO -> pole -> ISO zachowuje moment z dokładnością do minuty", () => {
    const iso = fromLocalInput(toLocalInput("2026-09-01T08:30:00.000Z"));
    expect(iso).not.toBeNull();
    expect(new Date(iso as string).toISOString()).toBe("2026-09-01T08:30:00.000Z");
  });
});

describe("ticketDraftFromRow", () => {
  const row = {
    id: "t-1",
    key: "standard",
    name_pl: "Standard",
    name_en: "Standard",
    description_pl: "",
    description_en: "",
    price_cents: 0,
    currency: "EUR",
    quota: null as unknown as number,
    sales_from: null as unknown as string,
    sales_to: null as unknown as string,
    min_tier_rank: 0,
    requires_approval: true,
    group_id: null as unknown as string,
    is_active: true,
    sort_order: 20,
  } as unknown as EventTicketRow;

  it("brak limitu z bazy zostaje pustym polem, nie zerem", () => {
    const draft = ticketDraftFromRow(row);
    expect(draft.quota).toBe("");
    expect(draft.salesFrom).toBe("");
    expect(draft.currency).toBe("EUR");
    expect(draft.id).toBe("t-1");
  });

  it("nieznana waluta spada do PLN, zamiast wysypywać listę wyboru", () => {
    const draft = ticketDraftFromRow({ ...row, currency: "CHF" } as EventTicketRow);
    expect(draft.currency).toBe("PLN");
  });
});
