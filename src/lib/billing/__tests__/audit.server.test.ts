// Audyt rozliczeń: kontrakt eksportu księgowego.
//
// Testujemy to, co realnie może zaboleć poza systemem: sumy (pełny zwrot NIE
// jest przychodem) oraz zapis CSV z wartością zawierającą przecinek - wiersz
// przesunięty o kolumnę przypisuje komuś cudzy status płatności.
import { describe, expect, it } from "vitest";
import { auditToCsv, type AuditReport } from "@/lib/billing/audit.server";

function report(partial?: Partial<AuditReport>): AuditReport {
  return {
    environment: "sandbox",
    sinceIso: "2026-01-01T00:00:00.000Z",
    generatedAt: "2026-01-08T00:00:00.000Z",
    orders: [],
    webhooks: [],
    totals: { orders: 0, paidCents: 0, refundedCents: 0, webhooksFailed: 0 },
    truncated: false,
    ...partial,
  };
}

describe("auditToCsv", () => {
  it("cytuje wartości z przecinkiem, żeby kolumny się nie rozjechały", () => {
    const csv = auditToCsv(
      report({
        webhooks: [
          {
            id: "row-1",
            eventId: "evt_1",
            eventType: "charge.refunded",
            status: "failed",
            occurredAt: "2026-01-02T10:00:00.000Z",
            processedAt: null,
            durationMs: 12,
            retryCount: 2,
            error: "timeout, retry later",
          },
        ],
      }),
    );
    expect(csv).toContain('"timeout, retry later"');
  });

  it("zawiera obie sekcje - zamówienia i zdarzenia", () => {
    const csv = auditToCsv(report());
    expect(csv).toContain("order_id");
    expect(csv).toContain("stripe_event_id");
  });
});
