// Zgodność daty końca dostępu ze zdarzeniami operatora płatności.
//
// Regresja, której pilnują te testy: zdarzenie stanu bez okresu rozliczeniowego
// (pauza, past_due, wznowienie, samo `canceled`) kasowało zapisaną datę końca
// dostępu i użytkownik tracił opłacony czas.
import { describe, expect, it } from "vitest";

import { accessActiveAt, accessPeriodFromEvent } from "@/lib/billing/accessPeriod";

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
