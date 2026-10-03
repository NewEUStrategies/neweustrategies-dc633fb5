// HISTORIA PŁATNOŚCI - DANE NIEPEŁNE I NIETYPOWE (`paymentHistory`).
//
// `paymentHistory.test.ts` dowodzi scalania zamówień z dokumentami i ochrony
// CSV przed formułami. Ten plik pilnuje tego, co klient widzi, gdy dane od
// operatora płatności są NIEKOMPLETNE albo przyszły w innym typie - bo to jest
// lista, z której tłumaczy sobie pozycje na wyciągu z karty, i plik CSV, który
// oddaje księgowej:
//
//  * rabat zapisany TEKSTEM (metadane Stripe są zawsze napisami) nadal jest
//    rabatem, a tekst nieliczbowy nie zamienia się w `NaN` w kolumnie kwot,
//  * zakup jednorazowy (bilet, treść) nie udaje subskrypcji,
//  * pozycja ZAWSZE ma co zacytować: numer faktury, a bez niego identyfikator
//    dokumentu operatora; zamówienie bez sesji - własny identyfikator,
//  * kolumna „kod" mówi, skąd dostęp bez płatności (źródło nadania), a kolumna
//    „dokument" daje plik, a gdy go brak - stronę faktury, a nie pustkę.
import { describe, expect, it } from "vitest";

import {
  historyFileName,
  mergePaymentHistory,
  paymentHistoryToCsv,
} from "@/lib/billing/paymentHistory";
import type { BillingDocument, PaymentOrder } from "@/lib/billing/types";
import { DZIEN, FIXED_NOW_ISO, freezeClock, relativeIso } from "@/test/time";

freezeClock();

function order(patch: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: "order-1",
    tenant_id: "tenant-alfa",
    user_id: "user-me",
    kind: "subscription",
    status: "paid",
    amount_cents: 4900,
    currency: "pln",
    plan_id: "plan-member-monthly",
    entity_type: null,
    entity_id: null,
    provider: "stripe",
    provider_session_id: "cs_test_1",
    provider_intent_id: null,
    invoice_url: null,
    receipt_email: "klient@example.com",
    metadata: {},
    paid_at: relativeIso(-2 * DZIEN),
    created_at: relativeIso(-2 * DZIEN),
    updated_at: relativeIso(-2 * DZIEN),
    ...patch,
  };
}

function doc(patch: Partial<BillingDocument> = {}): BillingDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-alfa",
    user_id: "user-me",
    subscription_id: null,
    order_id: null,
    kind: "invoice",
    status: "paid",
    provider: "stripe",
    provider_document_id: "in_test_1",
    number: "FV/7/2099",
    amount_cents: 4900,
    currency: "pln",
    hosted_url: "https://invoice.example.com/in_test_1",
    pdf_url: "https://invoice.example.com/in_test_1.pdf",
    issued_at: relativeIso(-DZIEN),
    created_at: relativeIso(-DZIEN),
    updated_at: relativeIso(-DZIEN),
    ...patch,
  };
}

const labels = {
  number: "Numer",
  date: "Data",
  kind: "Rodzaj",
  amount: "Kwota",
  currency: "Waluta",
  status: "Status",
  document: "Dokument",
  discount: "Rabat",
  coupon: "Kod",
};

const COLUMNS = [
  "number",
  "date",
  "kind",
  "amount",
  "currency",
  "discount",
  "coupon",
  "status",
  "document",
] as const;

/** Wiersze danych CSV (bez BOM i nagłówka) jako obiekty kolumna -> wartość. */
function csvRows(csv: string): Array<Record<(typeof COLUMNS)[number], string>> {
  const [, ...lines] = csv
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split("\r\n");
  return lines.map((line) => {
    const cells = line.split(";");
    return Object.fromEntries(COLUMNS.map((col, i) => [col, cells[i] ?? ""])) as Record<
      (typeof COLUMNS)[number],
      string
    >;
  });
}

describe("mergePaymentHistory - rabat z metadanych zamówienia", () => {
  it("rabat zapisany tekstem (metadane operatora) jest liczbą w historii i w CSV", () => {
    const rows = mergePaymentHistory(
      [
        order({
          metadata: {
            coupon_code: "PARTNER-CEE",
            coupon_discount_cents: "1000",
            original_amount_cents: " 5900 ",
          },
        }),
      ],
      [],
    );

    expect(rows[0]).toMatchObject({
      discountCents: 1000,
      originalAmountCents: 5900,
      couponCode: "PARTNER-CEE",
    });
    expect(csvRows(paymentHistoryToCsv(rows, labels))[0]).toMatchObject({
      discount: "10.00",
      coupon: "PARTNER-CEE",
    });
  });

  it.each([
    { title: "tekst nieliczbowy", value: "10 zł" },
    { title: "pusty tekst", value: "   " },
    { title: "zero", value: 0 },
    { title: "wartość nie-liczbowa (obiekt)", value: { cents: 1000 } },
  ])("$title w polu rabatu -> brak rabatu, nie NaN w kolumnie kwot", ({ value }) => {
    const rows = mergePaymentHistory(
      [order({ metadata: { coupon_discount_cents: value, original_amount_cents: "n/d" } })],
      [],
    );

    expect(rows[0]).toMatchObject({ discountCents: null, originalAmountCents: null });
    const csv = paymentHistoryToCsv(rows, labels);
    expect(csvRows(csv)[0]?.discount).toBe("");
    expect(csv).not.toContain("NaN");
  });

  it("starszy klucz `discount_cents` nadal jest czytany, gdy nowego brak", () => {
    const [row] = mergePaymentHistory([order({ metadata: { discount_cents: "750" } })], []);

    expect(row?.discountCents).toBe(750);
  });
});

describe("mergePaymentHistory - co pozycja cytuje i jak się nazywa", () => {
  it("zakup jednorazowy (bilet, treść) jest pozycją jednorazową, nie subskrypcją", () => {
    const rows = mergePaymentHistory([order({ kind: "one_time" })], []);

    expect(rows[0]?.kind).toBe("one_time");
    expect(csvRows(paymentHistoryToCsv(rows, labels))[0]?.kind).toBe("one_time");
  });

  it("dokument bez numeru faktury cytuje identyfikator dokumentu operatora", () => {
    const rows = mergePaymentHistory([], [doc({ number: null })]);

    expect(rows[0]?.number).toBe("in_test_1");
    expect(csvRows(paymentHistoryToCsv(rows, labels))[0]?.number).toBe("in_test_1");
  });

  it("zamówienie bez sesji operatora cytuje własny identyfikator", () => {
    const rows = mergePaymentHistory([order({ provider_session_id: null })], []);

    expect(rows[0]?.number).toBe("order-1");
  });
});

describe("paymentHistoryToCsv - kolumny kodu i dokumentu", () => {
  it("kolumna kodu: kupon, źródło nadania, „gift” dla darmowego dokumentu, pusto dla zakupu", () => {
    const rows = mergePaymentHistory(
      [
        order({
          id: "order-coupon",
          provider_session_id: "cs_coupon",
          created_at: relativeIso(-1 * DZIEN),
          metadata: { coupon_code: "NES20" },
        }),
        order({
          id: "order-plain",
          provider_session_id: "cs_plain",
          created_at: relativeIso(-2 * DZIEN),
        }),
      ],
      [
        doc({
          id: "doc-free",
          number: "FV/0/2099",
          amount_cents: 0,
          issued_at: relativeIso(-3 * DZIEN),
        }),
      ],
      [
        {
          id: "grant-1",
          tierKey: "vip",
          source: "expert",
          note: null,
          startsAt: relativeIso(-4 * DZIEN),
          expiresAt: null,
          revokedAt: null,
        },
      ],
    );

    const csv = csvRows(paymentHistoryToCsv(rows, labels));

    expect(csv.map((r) => [r.number, r.coupon])).toEqual([
      ["cs_coupon", "NES20"],
      ["cs_plain", ""],
      ["FV/0/2099", "gift"],
      ["VIP", "expert"],
    ]);
  });

  it("kolumna dokumentu: plik PDF, bez pliku - strona faktury, bez obu - pusto", () => {
    const rows = mergePaymentHistory(
      [order({ provider_session_id: "cs_none", invoice_url: null })],
      [
        doc({ id: "doc-pdf", number: "FV/1/2099", issued_at: relativeIso(-1 * DZIEN) }),
        doc({
          id: "doc-hosted",
          number: "FV/2/2099",
          pdf_url: null,
          issued_at: relativeIso(-1.5 * DZIEN),
        }),
      ],
    );

    const csv = csvRows(paymentHistoryToCsv(rows, labels));

    expect(csv.map((r) => [r.number, r.document])).toEqual([
      ["FV/1/2099", "https://invoice.example.com/in_test_1.pdf"],
      ["FV/2/2099", "https://invoice.example.com/in_test_1"],
      ["cs_none", ""],
    ]);
  });
});

describe("historyFileName - data wygenerowania", () => {
  it("bez jawnej chwili nazwa pliku niesie DZISIEJSZĄ datę (UTC)", () => {
    expect(historyFileName("historia-platnosci", "pdf")).toBe(
      `historia-platnosci-${FIXED_NOW_ISO.slice(0, 10)}.pdf`,
    );
  });
});
