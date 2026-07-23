import { describe, it, expect } from "vitest";
import { couponAuditInDisplayCurrency } from "../displayCurrency";

describe("couponAuditInDisplayCurrency (parytet PLN/EUR + spójność audytu kuponu)", () => {
  it("PLN -> EUR: kwoty w EUR, niezmiennik original = final + discount", () => {
    // 100 PLN oryginał, 80 PLN finał (kupon 20%).
    const r = couponAuditInDisplayCurrency(10000, 8000, "PLN", "EUR");
    expect(r.currency).toBe("EUR");
    expect(r.originalCents).toBe(5000);
    expect(r.finalCents).toBe(4000);
    expect(r.discountCents).toBe(1000);
    expect(r.originalCents).toBe(r.finalCents + r.discountCents);
  });

  it("brak kuponu (original == final): rabat = 0 w każdej walucie", () => {
    const eur = couponAuditInDisplayCurrency(9900, 9900, "PLN", "EUR");
    expect(eur.discountCents).toBe(0);
    expect(eur.originalCents).toBe(eur.finalCents);
    const pln = couponAuditInDisplayCurrency(9900, 9900, "PLN", "PLN");
    expect(pln.discountCents).toBe(0);
    expect(pln.finalCents).toBe(9900);
  });

  it("ta sama waluta (PLN -> PLN): tożsamość, rabat = różnica", () => {
    const r = couponAuditInDisplayCurrency(10000, 7500, "PLN", "PLN");
    expect(r.currency).toBe("PLN");
    expect(r.originalCents).toBe(10000);
    expect(r.finalCents).toBe(7500);
    expect(r.discountCents).toBe(2500);
  });

  it("niezmiennik trzyma się dla nieparzystych wartości (rabat z różnicy, bez dryfu)", () => {
    for (const [orig, fin] of [
      [201, 101],
      [9999, 7333],
      [12345, 6789],
      [5001, 4999],
    ] as const) {
      const r = couponAuditInDisplayCurrency(orig, fin, "PLN", "EUR");
      expect(r.originalCents).toBe(r.finalCents + r.discountCents);
      expect(r.discountCents).toBeGreaterThanOrEqual(0);
    }
  });
});
