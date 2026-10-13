// Walidacja szkicu PAKIETU GRUPOWEGO.
//
// Sprawdzamy dokładnie te warunki, których odmowa wraca z bazy jako `23514` bez
// nazwy kolumny - gdyby przestały być wychwytywane tutaj, organizator dostałby
// „coś poszło nie tak" bez wskazania pola.
//
// DWIE NOWE OSIE (TIX-14a, TIX-07/09). Cena żyje w polu w złotych, a grosze
// liczy parser - zapis niejednoznaczny jest błędem, nie zgadywaną kwotą.
// Warunki zakupu i profil podatkowy są w szkicu tylko wtedy, gdy panel je ZNA;
// nieznane nie są ani sprawdzane, ani wysyłane - tego pilnuje tu `terms: null`.
import { describe, expect, it } from "vitest";
import {
  defaultPackageTerms,
  emptyPackageDraft,
  packageDraftFromRow,
  packageDraftIssue,
  packageDraftIssueMessage,
  packageDraftToInput,
  packageTermsForDraft,
  type PackageDraft,
  type PackageDraftIssue,
  type PackageTermsDraft,
  type PackageTermsLookup,
} from "@/lib/events/packageDraft";
import type { EventPackageTermsRow } from "@/lib/events/packagesApi";
import { eventPackageRow } from "@/test/events/adminSalesRows";

const EVENT = "11111111-2222-3333-4444-555555555555";
const TICKET = "66666666-7777-8888-9999-000000000000";
/** Strefa wydarzenia - okno sprzedaży jest zegarem w niej. */
const STREFA = "Europe/Warsaw";
const PACKAGE = "77777777-8888-4999-8000-111111111111";

function valid(overrides: Partial<PackageDraft> = {}): PackageDraft {
  return {
    ...emptyPackageDraft(100, STREFA),
    key: "delegacja_10",
    ticketTypeId: TICKET,
    namePl: "Delegacja 10",
    nameEn: "Delegation 10",
    ...overrides,
  };
}

function withTerms(overrides: Partial<PackageTermsDraft> = {}): PackageDraft {
  return valid({ terms: { ...defaultPackageTerms(), ...overrides } });
}

/** Zdanie przy polu dla szkicu, który MA błąd - brak błędu przewraca test. */
function messageOf(issue: PackageDraftIssue | null): ReturnType<typeof packageDraftIssueMessage> {
  if (issue === null) throw new Error("test: szkic przeszedł walidację, a miał nie przejść");
  return packageDraftIssueMessage(issue);
}

function termsRow(overrides: Partial<EventPackageTermsRow> = {}): EventPackageTermsRow {
  return {
    id: PACKAGE,
    admit_before_payment: true,
    payment_terms_days: 30,
    max_open_orders_per_buyer: null,
    vat_rate: "zw",
    vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
    stripe_tax_code: "txcd_20030000",
    ...overrides,
  };
}

describe("packageDraftIssue", () => {
  it("przepuszcza poprawny szkic", () => {
    expect(packageDraftIssue(valid())).toBeNull();
  });

  it("wymaga klucza we wzorcu tylko dla nowego pakietu", () => {
    expect(packageDraftIssue(valid({ key: "10 Delegacja" }))?.field).toBe("key");
    // Przy edycji klucz jest zamrożony, więc jego treść nie blokuje zapisu.
    expect(packageDraftIssue(valid({ id: "abc", key: "10 Delegacja" }))).toBeNull();
  });

  it("wymaga wskazania biletu", () => {
    expect(packageDraftIssue(valid({ ticketTypeId: "" }))?.errorKey).toBe("packageTicketRequired");
  });

  it("odrzuca pakiet bez miejsc i ponad limitem", () => {
    expect(packageDraftIssue(valid({ seats: "0" }))?.field).toBe("seats");
    expect(packageDraftIssue(valid({ seats: "1001" }))?.field).toBe("seats");
    expect(packageDraftIssue(valid({ seats: "1" }))).toBeNull();
  });

  it("odrzuca okno sprzedaży kończące się przed startem", () => {
    const issue = packageDraftIssue(
      valid({ salesFrom: "2026-05-10T10:00", salesTo: "2026-05-09T10:00" }),
    );
    expect(issue?.errorKey).toBe("packageSalesWindow");
  });
});

describe("cena w złotych (TIX-14a)", () => {
  it.each(["899,00", "899.00", "899", "1 299,50", "1.299,50", "0"])(
    "zapis „%s” jest poprawny",
    (price) => {
      expect(packageDraftIssue(valid({ price }))).toBeNull();
    },
  );

  it.each([
    ["8,999", "trzy cyfry po przecinku - złotówka czy osiem tysięcy?"],
    ["1,299", "niejednoznaczny separator tysięcy"],
    ["", "pole puste"],
    ["-1", "kwota ujemna"],
    ["dużo", "litery"],
  ])("zapis „%s” zatrzymuje zapis zdaniem o formacie (%s)", (price) => {
    const issue = packageDraftIssue(valid({ price }));
    expect(issue?.field).toBe("price");
    expect(messageOf(issue)).toEqual({
      key: "adminEventRegistration.packages.editor.priceFormat.PLN",
      params: undefined,
    });
  });

  it("zdanie o formacie mówi walutą pakietu", () => {
    const issue = packageDraftIssue(valid({ price: "8,999", currency: "EUR" }));
    expect(issue?.messageKey).toBe("adminEventRegistration.packages.editor.priceFormat.EUR");
  });

  it("kwota ponad sufit to odmowa zakresu, liczona w groszach", () => {
    expect(packageDraftIssue(valid({ price: "100000,00" }))).toBeNull();
    const issue = packageDraftIssue(valid({ price: "100000,01" }));
    expect(issue?.field).toBe("price");
    expect(messageOf(issue).key).toBe("adminEventRegistration.errors.packagePriceRange");
  });

  it("„899,00”, „899.00” i „899” dają te same 89 900 groszy", () => {
    for (const price of ["899,00", "899.00", "899"]) {
      expect(packageDraftToInput(valid({ price }), EVENT).priceCents, price).toBe(89_900);
    }
  });

  it("wiersz z bazy wraca do pola w złotych - separator wg języka, kwota ta sama", () => {
    const row = eventPackageRow({ price_cents: 89_900 });
    expect(packageDraftFromRow(row, STREFA).price).toBe("899,00");
    expect(packageDraftFromRow(row, STREFA, null, ".").price).toBe("899.00");
    // Obieg wiersz -> pole -> ładunek nie zmienia kwoty (przełącznik w panelu).
    expect(packageDraftToInput(packageDraftFromRow(row, STREFA), EVENT).priceCents).toBe(89_900);
    expect(packageDraftToInput(packageDraftFromRow(row, STREFA, null, "."), EVENT).priceCents).toBe(
      89_900,
    );
  });
});

describe("packageTermsForDraft - skąd szkic bierze warunki", () => {
  const ready = (rows: EventPackageTermsRow[]): PackageTermsLookup => ({
    status: "ready",
    byPackage: new Map(rows.map((row) => [row.id, row])),
  });

  it("nowy pakiet startuje od wartości domyślnych kolumn", () => {
    expect(packageTermsForDraft(null, ready([]))).toEqual({
      admitBeforePayment: false,
      paymentTermsDays: "14",
      maxOpenOrdersPerBuyer: "3",
      taxProfile: { vatRate: "default", vatExemptBasis: "", stripeTaxCode: "" },
    });
  });

  it("zapisany pakiet startuje od SWOICH warunków, a pusty limit to brak limitu", () => {
    expect(packageTermsForDraft(PACKAGE, ready([termsRow()]))).toEqual({
      admitBeforePayment: true,
      paymentTermsDays: "30",
      maxOpenOrdersPerBuyer: "",
      taxProfile: {
        vatRate: "zw",
        vatExemptBasis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
        stripeTaxCode: "txcd_20030000",
      },
    });
  });

  it("zapisany pakiet BEZ wiersza w odpowiedzi ma warunki nieznane, nie domyślne", () => {
    expect(packageTermsForDraft(PACKAGE, ready([]))).toBeNull();
  });

  it.each<PackageTermsLookup>([
    { status: "loading" },
    { status: "unavailable" },
    { status: "failed", error: new Error("forbidden") },
  ])("stan „$status” nie daje warunków ani nowemu, ani zapisanemu pakietowi", (lookup) => {
    expect(packageTermsForDraft(null, lookup)).toBeNull();
    expect(packageTermsForDraft(PACKAGE, lookup)).toBeNull();
  });
});

describe("warunki zakupu - walidacja bez przycinania (TIX-07)", () => {
  it("wartości domyślne przechodzą", () => {
    expect(packageDraftIssue(withTerms())).toBeNull();
  });

  it.each(["1", "120", " 30 "])("termin płatności „%s” jest poprawny", (days) => {
    expect(packageDraftIssue(withTerms({ paymentTermsDays: days }))).toBeNull();
  });

  it.each(["0", "121", "14.5", "", "-3", "dwa"])(
    "termin płatności „%s” zatrzymuje zapis przy swoim polu",
    (days) => {
      const issue = packageDraftIssue(withTerms({ paymentTermsDays: days }));
      expect(issue?.field).toBe("paymentTermsDays");
      expect(messageOf(issue)).toEqual({
        key: "adminEventRegistration.packages.editor.paymentTermsDaysRange",
        params: { min: 1, max: 120 },
      });
    },
  );

  it.each(["", "1", "100"])("limit nieopłaconych zamówień „%s” jest poprawny", (limit) => {
    expect(packageDraftIssue(withTerms({ maxOpenOrdersPerBuyer: limit }))).toBeNull();
  });

  it.each(["0", "101", "2.5", "-1", "sporo"])(
    "limit nieopłaconych zamówień „%s” zatrzymuje zapis przy swoim polu",
    (limit) => {
      const issue = packageDraftIssue(withTerms({ maxOpenOrdersPerBuyer: limit }));
      expect(issue?.field).toBe("maxOpenOrdersPerBuyer");
      expect(messageOf(issue)).toEqual({
        key: "adminEventRegistration.packages.editor.maxOpenOrdersRange",
        params: { min: 1, max: 100 },
      });
    },
  );

  it("błędny kod Stripe i za długa podstawa zatrzymują zapis (TIX-09)", () => {
    const code = packageDraftIssue(
      withTerms({
        taxProfile: { vatRate: "default", vatExemptBasis: "", stripeTaxCode: "txcd_1" },
      }),
    );
    expect(code).toMatchObject({ field: "stripeTaxCode", errorKey: "invalidTaxCode" });

    const basis = packageDraftIssue(
      withTerms({
        taxProfile: { vatRate: "zw", vatExemptBasis: "a".repeat(301), stripeTaxCode: "" },
      }),
    );
    expect(basis).toMatchObject({ field: "vatExemptBasis", errorKey: "invalidExemptBasis" });
  });

  it("błąd pól oferty wygrywa z błędem warunków - formularz podświetla jedno pole naraz", () => {
    const issue = packageDraftIssue({
      ...withTerms({ paymentTermsDays: "0" }),
      seats: "0",
    });
    expect(issue?.field).toBe("seats");
  });
});

describe("packageDraftToInput", () => {
  it("zamienia pustą pulę na brak limitu, a nie na zero", () => {
    const input = packageDraftToInput(valid({ quota: "" }), EVENT);
    expect(input.quota).toBeNull();
    expect(packageDraftToInput(valid({ quota: "0" }), EVENT).quota).toBe(0);
  });

  it("przycina nazwy i przenosi wydarzenie", () => {
    const input = packageDraftToInput(valid({ namePl: "  Delegacja  " }), EVENT);
    expect(input.namePl).toBe("Delegacja");
    expect(input.eventId).toBe(EVENT);
    expect(input.seats).toBe(5);
  });

  it("warunki NIEZNANE nie jadą - `terms: null`, a nie wartości domyślne", () => {
    expect(packageDraftToInput(valid(), EVENT).terms).toBeNull();
    // Szkic z samego wiersza (przełącznik „aktywny" w panelu) też ich nie zna.
    expect(
      packageDraftToInput(packageDraftFromRow(eventPackageRow(), STREFA), EVENT).terms,
    ).toBeNull();
  });

  it("warunki ZNANE jadą liczbami, pusty limit jako jawny brak limitu", () => {
    const input = packageDraftToInput(
      withTerms({
        admitBeforePayment: true,
        paymentTermsDays: " 30 ",
        maxOpenOrdersPerBuyer: "",
        taxProfile: { vatRate: "8", vatExemptBasis: "  ", stripeTaxCode: " TXCD_10000000 " },
      }),
      EVENT,
    );
    expect(input.terms).toEqual({
      admitBeforePayment: true,
      paymentTermsDays: 30,
      maxOpenOrdersPerBuyer: null,
      tax: { vat_rate: "8", vat_exempt_basis: "", stripe_tax_code: "txcd_10000000" },
    });
  });

  it("wartości domyślne nowego pakietu jadą tak, jak ustawiłaby je baza", () => {
    expect(packageDraftToInput(withTerms(), EVENT).terms).toEqual({
      admitBeforePayment: false,
      paymentTermsDays: 14,
      maxOpenOrdersPerBuyer: 3,
      tax: { vat_rate: null, vat_exempt_basis: "", stripe_tax_code: null },
    });
  });

  it("warunki, których nie da się przeczytać, NIE jadą wartością zastępczą", () => {
    // Wołający, który pominął walidację, zostawia kolumny bez zmian - literówka
    // w limicie nie może się zamienić w „bez limitu".
    const input = packageDraftToInput(withTerms({ maxOpenOrdersPerBuyer: "1o" }), EVENT);
    expect(input.terms).toBeNull();
  });
});
