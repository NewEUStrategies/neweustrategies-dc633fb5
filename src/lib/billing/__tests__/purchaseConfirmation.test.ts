// Kontrakt sekcji potwierdzenia zakupu: co dokładnie widzi kupujący
// (rodzaj zakupu, data końca dostępu, dostępność portalu klienta).
import { describe, expect, it } from "vitest";

import {
  accessUntilFromOrder,
  buildPurchaseSummary,
  daysLeft,
  formatAccessDate,
} from "@/lib/billing/purchaseConfirmation";
import type { PaddleSubscriptionRow } from "@/lib/billing/paddleSubscription";
import type { PaymentOrder } from "@/lib/billing/types";

const now = new Date("2026-07-29T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

const sub = (over: Partial<PaddleSubscriptionRow> = {}): PaddleSubscriptionRow => ({
  id: "row-1",
  provider_subscription_id: "sub_1",
  provider_customer_id: "ctm_1",
  product_id: "starter_plan",
  price_id: "starter_monthly",
  status: "active",
  quantity: 1,
  current_period_start: inDays(-2),
  current_period_end: inDays(28),
  cancel_at_period_end: false,
  environment: "sandbox",
  created_at: inDays(-2),
  ...over,
});

const order = (over: Partial<PaymentOrder> = {}): PaymentOrder =>
  ({
    id: "ord-1",
    tenant_id: "t",
    user_id: "u",
    kind: "one_time",
    status: "paid",
    amount_cents: 9900,
    currency: "PLN",
    plan_id: null,
    entity_type: null,
    entity_id: null,
    provider: "paddle",
    provider_session_id: null,
    provider_intent_id: "txn_1",
    invoice_url: null,
    receipt_email: null,
    metadata: {},
    paid_at: inDays(0),
    created_at: inDays(0),
    updated_at: inDays(0),
    ...over,
  }) as PaymentOrder;

describe("buildPurchaseSummary", () => {
  it("aktywna subskrypcja odnawia się i udostępnia portal klienta", () => {
    const s = buildPurchaseSummary({ subscription: sub(), now });
    expect(s.kind).toBe("subscription");
    expect(s.renews).toBe(true);
    expect(s.expired).toBe(false);
    expect(s.portalAvailable).toBe(true);
    expect(s.accessEndsAt).toBe(inDays(28));
  });

  it("anulowana subskrypcja zachowuje dostęp do końca okresu, ale bez odnowienia", () => {
    const s = buildPurchaseSummary({
      subscription: sub({ cancel_at_period_end: true }),
      now,
    });
    expect(s.renews).toBe(false);
    expect(s.expired).toBe(false);
    expect(s.accessEndsAt).toBe(inDays(28));
  });

  it("wygasły okres oznaczany jest jako zakończony", () => {
    const s = buildPurchaseSummary({
      subscription: sub({ status: "canceled", current_period_end: inDays(-1) }),
      now,
    });
    expect(s.expired).toBe(true);
    expect(s.renews).toBe(false);
  });

  it("brak klienta u operatora ukrywa portal", () => {
    const s = buildPurchaseSummary({ subscription: sub({ provider_customer_id: "" }), now });
    expect(s.portalAvailable).toBe(false);
  });

  it("zakup jednorazowy czyta datę dostępu z metadanych zamówienia", () => {
    const s = buildPurchaseSummary({
      order: order({ metadata: { access_until: inDays(365) } }),
      now,
    });
    expect(s.kind).toBe("one_time");
    expect(s.accessEndsAt).toBe(inDays(365));
    expect(s.portalAvailable).toBe(false);
    expect(s.reference).toBe("txn_1");
    expect(s.amountCents).toBe(9900);
  });

  it("subskrypcja ma pierwszeństwo przed starszym zamówieniem", () => {
    const s = buildPurchaseSummary({ subscription: sub(), order: order(), now });
    expect(s.kind).toBe("subscription");
  });

  it("oczekująca płatność nie deklaruje dostępu", () => {
    const s = buildPurchaseSummary({ order: order({ status: "pending" }), now });
    expect(s.kind).toBe("none");
    expect(s.accessEndsAt).toBeNull();
  });

  it("brak danych = brak zakupu", () => {
    expect(buildPurchaseSummary({ now }).kind).toBe("none");
  });
});

describe("accessUntilFromOrder", () => {
  it("odrzuca wartości, które nie są datą", () => {
    expect(accessUntilFromOrder(order({ metadata: { access_until: "kiedyś" } }))).toBeNull();
    expect(accessUntilFromOrder(order({ metadata: { access_until: 12 } }))).toBeNull();
  });

  it("akceptuje wariant camelCase", () => {
    expect(accessUntilFromOrder(order({ metadata: { accessUntil: inDays(10) } }))).toBe(inDays(10));
  });
});

describe("prezentacja daty", () => {
  it("formatuje datę w języku interfejsu", () => {
    expect(formatAccessDate("2026-08-30T10:00:00Z", "pl")).toContain("2026");
    expect(formatAccessDate(null, "en")).toBeNull();
  });

  it("liczy pozostałe dni bez wartości ujemnych", () => {
    expect(daysLeft(inDays(3), now)).toBe(3);
    expect(daysLeft(inDays(-5), now)).toBe(0);
  });
});
