// Szkic biletu: konwersje i warunki, które baza sprawdza CHECK-iem.
//
// Testy celują w te przypadki, w których błąd jest CICHY: puste pole puli
// zamienione na zero (bilet natychmiast wyprzedany), pusta data zamieniona na
// „1970" i cena wpisana w złotych, a policzona jak grosze (TIX-14a: „899"
// znaczyło 8,99 zł). Pole ceny mówi teraz w jednostce głównej waluty, a zapis
// niejednoznaczny („8,999") jest odmową przy polu, nie zgadywaną kwotą.
import { describe, expect, it } from "vitest";
import {
  emptyTicketDraft,
  fromLocalInput,
  ticketDraftFromRow,
  ticketDraftIssue,
  ticketDraftIssueMessage,
  ticketDraftToInput,
  toLocalInput,
  type TicketDraft,
} from "@/lib/events/ticketDraft";
import type { EventTicketRow } from "@/lib/events/registrationsApi";

/**
 * Strefa wydarzenia - terminy biletu są zegarem w niej. Obca strefa
 * przeglądarki i noce zmiany czasu: `eventLocalInputZone.test.ts`.
 */
const STREFA = "Europe/Warsaw";

function valid(overrides: Partial<TicketDraft> = {}): TicketDraft {
  return {
    ...emptyTicketDraft(10, STREFA),
    key: "vip_pass",
    namePl: "Karnet VIP",
    nameEn: "VIP pass",
    price: "150,00",
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

  it("cena z minusem, literą, pusta albo niejednoznaczna jest odrzucana przed żądaniem", () => {
    // „8,999" i „1,299" mogą znaczyć tysiące albo złotówki z groszami w trzech
    // cyfrach - takiej kwoty nie zgadujemy.
    for (const price of ["-1", "abc", "", "8,999", "1,299", "19.999", "12,5,0"]) {
      expect(ticketDraftIssue(valid({ price })), price).toEqual({
        field: "price",
        errorKey: "invalidRequest",
        messageKey: "adminEventRegistration.tickets.editor.moneyFormat.PLN",
      });
    }
  });

  it("cena w złotych przechodzi z przecinkiem, kropką, bez groszy i z odstępem tysięcy", () => {
    for (const price of ["150,00", "150.00", "150", "0", "1 299,00", "1.299,00", "0,5"]) {
      expect(ticketDraftIssue(valid({ price })), price).toBeNull();
    }
  });

  it("zdanie o formacie kwoty mówi w walucie biletu", () => {
    const issue = ticketDraftIssue(valid({ currency: "EUR", price: "8,999" }));
    if (issue === null) throw new Error("„8,999” przeszło walidację");
    expect(ticketDraftIssueMessage(issue)).toEqual({
      key: "adminEventRegistration.tickets.editor.moneyFormat.EUR",
      params: undefined,
    });
  });

  it("odmowa bez własnego zdania czyta słownik odmów bazy", () => {
    const issue = ticketDraftIssue(valid({ quota: "-3" }));
    if (issue === null) throw new Error("ujemna pula przeszła walidację");
    expect(ticketDraftIssueMessage(issue)).toEqual({
      key: "adminEventRegistration.errors.invalidRequest",
    });
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

  it.each([
    ["899,00", 89_900],
    ["899", 89_900],
    ["899.00", 89_900],
    ["8,99", 899],
    ["0,5", 50],
    ["1 299,00", 129_900],
    ["  19,99  ", 1999],
  ])("cena „%s” jedzie do payloadu jako %i groszy", (price, cents) => {
    expect(ticketDraftIssue(valid({ price }))).toBeNull();
    expect(ticketDraftToInput(valid({ price }), "e-1").priceCents).toBe(cents);
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
    expect(fromLocalInput("", STREFA)).toBeNull();
    expect(fromLocalInput("   ", STREFA)).toBeNull();
    expect(fromLocalInput("2026-13-45T99:99", STREFA)).toBeNull();
    expect(toLocalInput(null, STREFA)).toBe("");
    expect(toLocalInput("nonsense", STREFA)).toBe("");
  });

  it("ISO -> pole -> ISO zachowuje moment z dokładnością do minuty", () => {
    const local = toLocalInput("2026-09-01T08:30:00.000Z", STREFA);
    // Pole pokazuje zegar WYDARZENIA (CEST), niezależnie od strefy maszyny.
    expect(local).toBe("2026-09-01T10:30");
    const iso = fromLocalInput(local, STREFA);
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
    const draft = ticketDraftFromRow(row, STREFA);
    expect(draft.quota).toBe("");
    expect(draft.salesFrom).toBe("");
    expect(draft.currency).toBe("EUR");
    expect(draft.id).toBe("t-1");
  });

  it("grosze z bazy wracają do pola w złotych - z separatorem języka interfejsu", () => {
    const paid = { ...row, price_cents: 89_900 } as EventTicketRow;
    expect(ticketDraftFromRow(paid).price).toBe("899,00");
    expect(ticketDraftFromRow(paid, ".").price).toBe("899.00");
    expect(ticketDraftFromRow(row).price).toBe("0,00");
  });

  it("wiersz -> pole -> payload oddaje te same grosze, także z kropką", () => {
    for (const cents of [0, 1, 99, 1999, 89_900, 10_000_000]) {
      const paid = { ...row, price_cents: cents } as EventTicketRow;
      for (const separator of [",", "."] as const) {
        const draft = ticketDraftFromRow(paid, separator);
        expect(ticketDraftIssue(draft), `${cents} ${separator}`).toBeNull();
        expect(ticketDraftToInput(draft, "e-1").priceCents).toBe(cents);
      }
    }
  });

  it("nieznana waluta spada do PLN, zamiast wysypywać listę wyboru", () => {
    const draft = ticketDraftFromRow({ ...row, currency: "CHF" } as EventTicketRow, STREFA);
    expect(draft.currency).toBe("PLN");
  });
});
