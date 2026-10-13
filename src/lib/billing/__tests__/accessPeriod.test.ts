// Zgodność daty końca dostępu ze zdarzeniami operatora płatności.
//
// Regresja, której pilnują te testy: zdarzenie stanu bez okresu rozliczeniowego
// (pauza, past_due, wznowienie, samo `canceled`) kasowało zapisaną datę końca
// dostępu i użytkownik tracił opłacony czas.
import { describe, expect, it } from "vitest";

import {
  PAYMENT_GRACE_DAYS,
  accessActiveAt,
  accessPeriodFromEvent,
  effectiveCancellationReason,
  isDelinquentSubscriptionStatus,
  isEntitledSubscriptionStatus,
  isNonPaymentCancellation,
  paymentCoversPeriod,
  paymentGraceEnd,
} from "@/lib/billing/accessPeriod";

const now = new Date("2026-07-29T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe("accessPeriodFromEvent", () => {
  it("nowa subskrypcja zapisuje okres ze zdarzenia", () => {
    const p = accessPeriodFromEvent({ kind: "created", eventPeriodEnd: inDays(30) });
    expect(p.periodEnd).toBe(inDays(30));
    expect(p.accessUntil).toBe(inDays(30));
    expect(p.extendsPeriod).toBe(true);
  });

  it("pauza bez okresu nie skraca opłaconego dostępu", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      eventPeriodEnd: null,
      storedPeriodEnd: inDays(20),
      status: "paused",
    });
    expect(p.periodEnd).toBe(inDays(20));
    expect(p.extendsPeriod).toBe(false);
  });

  it("past_due zachowuje okres i nie odbiera dostępu przed czasem", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      eventPeriodEnd: null,
      storedPeriodEnd: inDays(5),
      status: "past_due",
    });
    expect(accessActiveAt(p.accessUntil, now)).toBe(true);
  });

  it("odnowienie wydłuża okres", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      eventPeriodEnd: inDays(60),
      storedPeriodEnd: inDays(30),
      status: "active",
    });
    expect(p.periodEnd).toBe(inDays(60));
    expect(p.extendsPeriod).toBe(true);
  });

  it("spóźnione zdarzenie ze starszym okresem nie cofa dostępu", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      eventPeriodEnd: inDays(10),
      storedPeriodEnd: inDays(40),
      status: "active",
    });
    expect(p.periodEnd).toBe(inDays(40));
    expect(p.extendsPeriod).toBe(false);
  });

  it("anulowanie utrzymuje dostęp do końca opłaconego okresu", () => {
    const p = accessPeriodFromEvent({
      kind: "canceled",
      eventPeriodEnd: null,
      storedPeriodEnd: inDays(12),
    });
    expect(p.accessUntil).toBe(inDays(12));
    expect(p.extendsPeriod).toBe(false);
    expect(accessActiveAt(p.accessUntil, now)).toBe(true);
  });

  it("anulowanie po wygaśnięciu okresu kończy dostęp", () => {
    const p = accessPeriodFromEvent({
      kind: "canceled",
      storedPeriodEnd: inDays(-1),
    });
    expect(accessActiveAt(p.accessUntil, now)).toBe(false);
  });

  it("brak jakiejkolwiek daty oznacza dostęp bezterminowy", () => {
    const p = accessPeriodFromEvent({ kind: "updated" });
    expect(p.periodEnd).toBeNull();
    expect(accessActiveAt(p.accessUntil, now)).toBe(true);
  });

  it("niepoprawna data ze zdarzenia jest ignorowana", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      eventPeriodEnd: "wkrótce",
      storedPeriodEnd: inDays(9),
    });
    expect(p.periodEnd).toBe(inDays(9));
  });
});

// Karencja płatności (audyt SUB-03): okres operatora to nie okres opłacony -
// przy odnowieniu Stripe przesuwa koniec okresu o cały cykl PRZED obciążeniem.
describe("karencja płatności", () => {
  it("roczne past_due: dostęp do pierwszej porażki + karencja, okres operatora bez zmian", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      status: "past_due",
      eventPeriodEnd: inDays(365),
      periodStart: inDays(0),
      firstPaymentFailedAt: inDays(-2),
      now,
    });
    expect(p.periodEnd).toBe(inDays(365));
    expect(p.accessUntil).toBe(inDays(PAYMENT_GRACE_DAYS - 2));
  });

  it("unpaid liczy tę samą karencję, a bez kotwicy porażki - od początku okresu", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      status: "unpaid",
      eventPeriodEnd: inDays(30),
      periodStart: inDays(-20),
      now,
    });
    expect(p.accessUntil).toBe(inDays(PAYMENT_GRACE_DAYS - 20));
    expect(accessActiveAt(p.accessUntil, now)).toBe(false);
  });

  it("karencja nigdy nie przekracza końca okresu", () => {
    expect(paymentGraceEnd({ firstPaymentFailedAt: inDays(-1), periodEnd: inDays(5), now })).toBe(
      inDays(5),
    );
  });

  it("bez żadnej kotwicy karencja liczy się od „teraz”, a nie do końca okresu", () => {
    expect(paymentGraceEnd({ periodEnd: inDays(365), now })).toBe(inDays(PAYMENT_GRACE_DAYS));
  });

  it("anulowanie za brak płatności kończy dostęp z karencją, nie z końcem roku", () => {
    for (const reason of ["payment_failed", "payment_disputed"]) {
      const p = accessPeriodFromEvent({
        kind: "canceled",
        eventPeriodEnd: inDays(340),
        periodStart: inDays(-25),
        firstPaymentFailedAt: inDays(-25),
        cancellationReason: reason,
        now,
      });
      expect(p.accessUntil, reason).toBe(inDays(PAYMENT_GRACE_DAYS - 25));
      expect(accessActiveAt(p.accessUntil, now), reason).toBe(false);
    }
  });

  it("rezygnacja klienta zostawia dostęp do końca okresu", () => {
    const p = accessPeriodFromEvent({
      kind: "canceled",
      eventPeriodEnd: inDays(20),
      firstPaymentFailedAt: inDays(-25),
      cancellationReason: "cancellation_requested",
      now,
    });
    expect(p.accessUntil).toBe(inDays(20));
  });

  it("aktywna subskrypcja ignoruje zapisaną kotwicę porażki", () => {
    const p = accessPeriodFromEvent({
      kind: "updated",
      status: "active",
      eventPeriodEnd: inDays(30),
      firstPaymentFailedAt: inDays(-25),
      now,
    });
    expect(p.accessUntil).toBe(inDays(30));
  });

  it("słownik stanów: uprawniające, zaległe, anulowanie za brak płatności", () => {
    expect(["active", "trialing"].every(isEntitledSubscriptionStatus)).toBe(true);
    expect(["past_due", "unpaid", "paused", "incomplete"].some(isEntitledSubscriptionStatus)).toBe(
      false,
    );
    expect(["past_due", "unpaid"].every(isDelinquentSubscriptionStatus)).toBe(true);
    expect(isNonPaymentCancellation("cancellation_requested")).toBe(false);
    expect(isNonPaymentCancellation(null)).toBe(false);
  });
});

// Anulowanie bez powodu u operatora (stare wersje API, dawne anulowania):
// kotwica karencji w wierszu bez zapłaty za bieżący okres to koniec
// windykacji - inaczej ponowne `deleted` cofało przycięcie do końca roku.
describe("powód anulowania bez `cancellation_details`", () => {
  it("powód operatora zawsze wygrywa", () => {
    expect(
      effectiveCancellationReason({
        reason: "cancellation_requested",
        firstPaymentFailedAt: inDays(-5),
        periodStart: inDays(-5),
      }),
    ).toBe("cancellation_requested");
  });

  it("brak powodu + kotwica bez zapłaty za okres = brak płatności; bez kotwicy - rezygnacja", () => {
    const base = { firstPaymentFailedAt: inDays(-5), periodStart: inDays(-5) };
    expect(effectiveCancellationReason({ ...base, lastPaymentAt: inDays(-370) })).toBe(
      "payment_failed",
    );
    expect(effectiveCancellationReason({ ...base, lastPaymentAt: null })).toBe("payment_failed");
    expect(effectiveCancellationReason({ ...base, firstPaymentFailedAt: null })).toBeNull();
  });

  it("zapłata zaksięgowana w bieżącym okresie znosi wnioskowanie z kotwicy", () => {
    expect(
      effectiveCancellationReason({
        firstPaymentFailedAt: inDays(-5),
        periodStart: inDays(-5),
        lastPaymentAt: inDays(-1),
      }),
    ).toBeNull();
  });

  it("zapłata pokrywa okres od jego początku; bez którejkolwiek daty - nie", () => {
    expect(paymentCoversPeriod(inDays(-5), inDays(-5))).toBe(true);
    expect(paymentCoversPeriod(inDays(-6), inDays(-5))).toBe(false);
    expect(paymentCoversPeriod(null, inDays(-5))).toBe(false);
    expect(paymentCoversPeriod(inDays(-1), null)).toBe(false);
  });
});
