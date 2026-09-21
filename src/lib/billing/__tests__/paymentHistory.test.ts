import { describe, expect, it } from "vitest";

import { historyFileName, mergePaymentHistory, paymentHistoryToCsv } from "../paymentHistory";
import type { BillingDocument, PaymentOrder } from "../types";

function order(patch: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: "order-1",
    amount_cents: 4900,
    currency: "eur",
    status: "paid",
    kind: "subscription",
    created_at: "2026-02-01T10:00:00.000Z",
    invoice_url: null,
    provider_session_id: "cs_test_1",
    metadata: null,
    ...patch,
  } as PaymentOrder;
}

function document(patch: Partial<BillingDocument> = {}): BillingDocument {
  return {
    id: "doc-1",
    tenant_id: "t",
    user_id: "u",
    subscription_id: null,
    order_id: "order-1",
    kind: "invoice",
    status: "paid",
    provider: "stripe",
    provider_document_id: "in_1",
    number: "FV/2026/02",
    amount_cents: 4900,
    currency: "eur",
    hosted_url: "https://invoice.example/1",
    pdf_url: "https://invoice.example/1.pdf",
    issued_at: "2026-02-01T10:05:00.000Z",
    created_at: "2026-02-01T10:05:00.000Z",
    updated_at: "2026-02-01T10:05:00.000Z",
    ...patch,
  } as BillingDocument;
}

describe("mergePaymentHistory", () => {
  it("prefers the document over the order it was issued for", () => {
    const rows = mergePaymentHistory([order()], [document()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe("FV/2026/02");
    expect(rows[0]?.source).toBe("document");
  });

  it("keeps orders that have no document yet", () => {
    const rows = mergePaymentHistory([order({ id: "order-2", provider_session_id: "cs_2" })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe("cs_2");
    expect(rows[0]?.kind).toBe("subscription");
  });

  it("sorts newest first across both sources", () => {
    const rows = mergePaymentHistory(
      [order({ id: "order-9", created_at: "2026-03-05T00:00:00.000Z" })],
      [document({ order_id: null, issued_at: "2026-01-05T00:00:00.000Z" })],
    );
    expect(rows.map((r) => r.source)).toEqual(["order", "document"]);
  });
});

describe("paymentHistoryToCsv", () => {
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

  it("emits a BOM, semicolons and machine-readable amounts", () => {
    const csv = paymentHistoryToCsv(mergePaymentHistory([], [document()]), labels);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const [, row] = csv.trim().split("\r\n");
    expect(row).toBe(
      "FV/2026/02;2026-02-01;invoice;49.00;EUR;;;paid;https://invoice.example/1.pdf",
    );
  });

  it("quotes values containing the separator", () => {
    const csv = paymentHistoryToCsv(
      mergePaymentHistory([], [document({ number: 'FV;2026 "A"' })]),
      labels,
    );
    expect(csv).toContain('"FV;2026 ""A"""');
  });

  // Neutralizacja wstrzyknięcia formuły idzie ze wspólnego modułu
  // (`lib/csv/formatCsv`). Wektor jest tu realny: `number` dokumentu
  // i `couponCode` pochodzą od OPERATORA PŁATNOŚCI, a plik użytkownik otwiera
  // lokalnie w arkuszu.
  it("neutralizes a formula payload in provider-supplied fields", () => {
    const csv = paymentHistoryToCsv(
      mergePaymentHistory([], [document({ number: "=cmd|'/c calc'!A0" })]),
      labels,
    );
    const [, row] = csv.trim().split("\r\n");

    expect(row?.split(";")[0]).toBe("'=cmd|'/c calc'!A0");
    expect(row?.startsWith("=")).toBe(false);
  });

  it("keeps a negative amount numeric - the column must still add up", () => {
    // Druga strona reguły: apostrof nałożony bez rozróżnienia zamieniłby
    // korektę na tekst i kolumna kwot przestałaby się sumować.
    const csv = paymentHistoryToCsv(
      mergePaymentHistory([], [document({ kind: "credit_note", amount_cents: -4900 })]),
      labels,
    );
    const [, row] = csv.trim().split("\r\n");
    const amount = row?.split(";")[3] ?? "";

    expect(amount).toBe("-49.00");
    expect(Number(amount)).toBe(-49);
  });
});

describe("historyFileName", () => {
  it("stamps the export with the generation date", () => {
    expect(historyFileName("payments", "csv", new Date("2026-03-01T12:00:00Z"))).toBe(
      "payments-2026-03-01.csv",
    );
  });
});

describe("mergePaymentHistory discounts and gifts", () => {
  it("carries coupon metadata from the order onto its document", () => {
    const rows = mergePaymentHistory(
      [
        order({
          metadata: {
            coupon_code: "NES20",
            coupon_discount_cents: 1000,
            original_amount_cents: 5900,
          },
        }),
      ],
      [document()],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].couponCode).toBe("NES20");
    expect(rows[0].discountCents).toBe(1000);
    expect(rows[0].originalAmountCents).toBe(5900);
  });

  it("marks zero-amount orders as gifts", () => {
    const [row] = mergePaymentHistory([order({ amount_cents: 0 })], []);
    expect(row.gift).toBe(true);
  });

  it("adds access grants as gift rows and skips revoked ones", () => {
    const rows = mergePaymentHistory(
      [],
      [],
      [
        {
          id: "g1",
          tierKey: "vip",
          source: "expert",
          note: null,
          startsAt: "2026-01-01T00:00:00.000Z",
          expiresAt: null,
          revokedAt: null,
        },
        {
          id: "g2",
          tierKey: "plus",
          source: "manual",
          note: null,
          startsAt: "2026-01-02T00:00:00.000Z",
          expiresAt: null,
          revokedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("grant");
    expect(rows[0].gift).toBe(true);
    expect(rows[0].giftSource).toBe("expert");
  });
});
