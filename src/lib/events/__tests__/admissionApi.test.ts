// Wycena wstepu: odczyt odpowiedzi bazy, ktora ma DWA ksztalty (zgoda z cena
// i odmowa z powodem). Test pilnuje, ze odmowa nie udaje zgody z zerowa cena -
// to bylaby najgorsza z mozliwych pomylek tego ekranu.
import { describe, expect, it } from "vitest";

import {
  ADMISSION_QUOTE_REASONS,
  TICKET_CHECKOUT_ONLY_REASONS,
  admissionQuoteMessageKey,
  packagePurchaseRefusal,
  parseAdmissionQuote,
  ticketCheckoutRefusal,
} from "@/lib/events/admissionApi";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";

describe("parseAdmissionQuote", () => {
  it("reads a priced package quote", () => {
    const quote = parseAdmissionQuote({
      ok: true,
      kind: "package",
      event_id: "11111111-1111-1111-1111-111111111111",
      audience: "academic",
      seats: 10,
      currency: "PLN",
      price_cents: 250000,
      discount_cents: 25000,
      total_cents: 225000,
      coupon_code: "PARTNER2026",
      seats_left: 3,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.kind).toBe("package");
    expect(quote.seats).toBe(10);
    expect(quote.totalCents).toBe(225000);
    expect(quote.couponCode).toBe("PARTNER2026");
    expect(quote.seatsLeft).toBe(3);
  });

  it("treats a missing seat limit as no limit, not as zero", () => {
    const quote = parseAdmissionQuote({ ok: true, kind: "ticket", seats_left: null });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.seatsLeft).toBeNull();
    expect(quote.currency).toBe("PLN");
  });

  it("keeps a refusal a refusal and carries its numbers", () => {
    const quote = parseAdmissionQuote({
      ok: false,
      reason: "per_person_limit",
      max_per_person: 2,
      owned: 2,
    });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe("per_person_limit");
    expect(quote.detail.max_per_person).toBe(2);
  });

  it("falls back to an unknown reason instead of inventing one", () => {
    const quote = parseAdmissionQuote({ ok: false, reason: "moon_phase" });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe("unknown");
  });

  it("treats a null response as a refusal", () => {
    expect(parseAdmissionQuote(null).ok).toBe(false);
  });

  it("czyta rodzaj kodu i rabat NA MIEJSCE - ekran pisze z nich „5 × 50 zł”", () => {
    const quote = parseAdmissionQuote({
      ok: true,
      kind: "package",
      seats: 5,
      price_cents: 320000,
      discount_cents: 25000,
      total_cents: 295000,
      discount_kind: "fixed",
      discount_per_seat_cents: 5000,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.discountKind).toBe("fixed");
    expect(quote.discountPerSeatCents).toBe(5000);
    expect(quote.totalCents).toBe(295000);
  });

  it("kod procentowy nie ma kwoty na miejsce, a wycena bez kodu - rodzaju", () => {
    const percent = parseAdmissionQuote({
      ok: true,
      kind: "package",
      discount_kind: "percent",
      discount_per_seat_cents: null,
    });
    const none = parseAdmissionQuote({ ok: true, kind: "package", discount_kind: null });
    if (!percent.ok || !none.ok) throw new Error("test: wycena miala byc zgoda");
    expect(percent.discountKind).toBe("percent");
    expect(percent.discountPerSeatCents).toBeNull();
    expect(none.discountKind).toBeNull();
    expect(none.discountPerSeatCents).toBeNull();
  });

  it("nieznany rodzaj kodu i nieliczbowa kwota na miejsce nie udają rabatu", () => {
    const quote = parseAdmissionQuote({
      ok: true,
      kind: "package",
      discount_kind: "amount",
      discount_per_seat_cents: "5000",
    });
    if (!quote.ok) throw new Error("test: wycena miala byc zgoda");
    expect(quote.discountKind).toBeNull();
    expect(quote.discountPerSeatCents).toBeNull();
  });

  it("kod BEZ RABATU (tylko odsłania bilety) ma własną nazwę odmowy", () => {
    const quote = parseAdmissionQuote({ ok: false, reason: "coupon_no_discount" });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe("coupon_no_discount");
    expect(ADMISSION_QUOTE_REASONS).toContain("coupon_no_discount");
  });
});

describe("packagePurchaseRefusal - odmowa zakupu przeniesiona z wyceny", () => {
  it("czyta `refused_<powód>` z wyjątku bazy", () => {
    expect(
      packagePurchaseRefusal(
        new Error("refused_coupon_exhausted: last use taken by a concurrent order"),
      ),
    ).toBe("coupon_exhausted");
    expect(packagePurchaseRefusal("refused_coupon_no_discount: coupon_no_discount")).toBe(
      "coupon_no_discount",
    );
  });

  it("nieznany powód i inne błędy to `null` - mają własny słownik", () => {
    expect(packagePurchaseRefusal(new Error("refused_moon_phase: x"))).toBeNull();
    expect(packagePurchaseRefusal(new Error("sold_out: no packages left"))).toBeNull();
  });
});

describe("słownik odmów - PL i EN mają zdanie dla każdego powodu", () => {
  it("każdy powód wyceny i kasy ma zdanie w obu językach", () => {
    const pl = eventRegistrationPl.eventPackages.quoteReasons as Record<string, string>;
    const en = eventRegistrationEn.eventPackages.quoteReasons as Record<string, string>;
    for (const reason of [...ADMISSION_QUOTE_REASONS, ...TICKET_CHECKOUT_ONLY_REASONS]) {
      expect(pl[reason], `pl:${reason}`).toBeTruthy();
      expect(en[reason], `en:${reason}`).toBeTruthy();
      expect(pl[reason], `pl=en:${reason}`).not.toBe(en[reason]);
    }
  });
});

describe("admissionQuoteMessageKey", () => {
  it("keeps every known reason inside one namespace", () => {
    for (const reason of ADMISSION_QUOTE_REASONS) {
      expect(admissionQuoteMessageKey(reason)).toBe(`eventPackages.quoteReasons.${reason}`);
    }
    expect(admissionQuoteMessageKey("unknown")).toBe("eventPackages.quoteReasons.unknown");
  });
});

// ---------------------------------------------------------------------------
// ODMOWY KASY WEJSCIOWKI
//
// `event_ticket_checkout_quote` i `createCheckoutOrder` rzucaja WLASNE kody
// bledow - inne niz `event_admission_quote`. Ekran potwierdzenia zapisu ma
// pokazac na kazdy z nich WLASNE zdanie, a nie jedno „sprobuj ponownie":
// „nie ma juz miejsc" i „to jest wliczone w Twoj plan" prowadza kupujacego
// w dwie zupelnie rozne strony.
//
// KODY SA PRZEPISANE Z CIALA FUNKCJI, nie wymyslone: `ticket_not_available`,
// `event_finished`, `ticket_sales_not_open`, `ticket_sales_closed`,
// `ticket_tier_required`, `ticket_access_code_invalid`, `ticket_sold_out`,
// `auth_required` (migracja 20260828054337) oraz `ticket_included_in_plan`
// i `registration_not_payable` (checkout.functions.ts).
// ---------------------------------------------------------------------------
describe("ticketCheckoutRefusal", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["ticket_not_available", "not_found"],
    ["ticket_not_available: no such ticket", "not_found"],
    ["event_finished", "event_finished"],
    ["ticket_sales_not_open", "sales_not_open"],
    ["ticket_sales_closed", "sales_closed"],
    ["ticket_tier_required", "tier_required"],
    ["ticket_access_code_invalid", "access_code_invalid"],
    ["ticket_sold_out: no seats left", "sold_out"],
    ["auth_required: sign in to buy a ticket", "account_required"],
    ["ticket_included_in_plan", "ticket_included_in_plan"],
    ["registration_not_payable:event_mismatch", "registration_not_payable"],
    // Awaria liczby miejsc to NIE „zgłoszenie odwołane albo rozliczone".
    ["registration_not_payable:seats_unavailable", "group_seats_unavailable"],
    ["Error: registration_not_payable:seats_unavailable", "group_seats_unavailable"],
    ["billing_unconfigured", "payments_unavailable"],
  ];

  for (const [message, reason] of cases) {
    it(`czyta „${message}" jako ${reason}`, () => {
      expect(ticketCheckoutRefusal(new Error(message))).toBe(reason);
    });
  }

  it("czyta goly napis tak samo jak wyjatek", () => {
    expect(ticketCheckoutRefusal("ticket_sold_out")).toBe("sold_out");
  });

  it("`ticket_sales_not_open` NIE jest czytane jako `sales_closed`", () => {
    // Oba kody zaczynaja sie od `ticket_sales_`, wiec kolejnosc dopasowania
    // decyduje o tym, czy kupujacy przeczyta „jeszcze nie w sprzedazy",
    // czy „sprzedaz zakonczona". To sa przeciwne zdania.
    expect(ticketCheckoutRefusal("ticket_sales_not_open")).not.toBe("sales_closed");
  });

  it("nieznany blad daje `unknown`, a nie zgadywanie", () => {
    expect(ticketCheckoutRefusal(new Error("cos_zupelnie_innego"))).toBe("unknown");
    expect(ticketCheckoutRefusal(null)).toBe("unknown");
    expect(ticketCheckoutRefusal("")).toBe("unknown");
    expect(ticketCheckoutRefusal({ code: 42 })).toBe("unknown");
  });

  it("kazdy powod kasowy ma klucz w TYM SAMYM zbiorze nazw", () => {
    for (const reason of TICKET_CHECKOUT_ONLY_REASONS) {
      expect(admissionQuoteMessageKey(reason)).toBe(`eventPackages.quoteReasons.${reason}`);
    }
  });

  it("powody kasowe NIE udaja powodow `event_admission_quote`", () => {
    // `ADMISSION_QUOTE_REASONS` odwzorowuje powody JEDNEJ funkcji bazy.
    // Dopisanie do niej nazwy, ktorej ta funkcja nie zwraca, zamienialoby
    // dokumentacje kontraktu w liste zyczen - dlatego zbiory sa rozlaczne.
    const shared = TICKET_CHECKOUT_ONLY_REASONS.filter((reason) =>
      (ADMISSION_QUOTE_REASONS as readonly string[]).includes(reason),
    );
    expect(shared).toEqual([]);
  });
});
