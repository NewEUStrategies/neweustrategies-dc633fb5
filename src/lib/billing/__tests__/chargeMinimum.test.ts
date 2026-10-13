// Minimum obciążenia u operatora - JEDNA reguła dla obu silników kasy
// i sesji z ceną osadzoną (przegląd PAY-01, 0.3).
//
// Do 12.10.2026 pierwszy silnik miał próg 50 jednostek w każdej walucie,
// drugi nie miał żadnego. Stripe obciąża w złotówkach od 2,00 zł, więc
// zamówienie na 1,50 zł mijało naszą bramkę i padało u operatora dopiero po
// założeniu zamówienia i rezerwacji kuponu. Moduł jest czysty - bez atrap.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MINIMUM_CHARGE_CENTS,
  isBelowMinimumCharge,
  minimumChargeCents,
} from "@/lib/billing/chargeMinimum";

describe("minimumChargeCents - minima operatora per waluta", () => {
  it.each([
    ["PLN", 200],
    ["EUR", 50],
    ["USD", 50],
    ["GBP", 30],
    ["CZK", 1500],
    ["HUF", 17500],
  ])("%s: %i jednostek najmniejszych", (currency, expected) => {
    expect(minimumChargeCents(currency)).toBe(expected);
  });

  it("kod waluty jest normalizowany (baza `PLN`, operator `pln`, spacje)", () => {
    expect(minimumChargeCents("pln")).toBe(200);
    expect(minimumChargeCents(" eur ")).toBe(50);
  });

  it("waluta spoza tabeli i brak waluty dostają próg domyślny", () => {
    expect(DEFAULT_MINIMUM_CHARGE_CENTS).toBe(50);
    expect(minimumChargeCents("XYZ")).toBe(50);
    expect(minimumChargeCents(null)).toBe(50);
    expect(minimumChargeCents(undefined)).toBe(50);
  });
});

describe("isBelowMinimumCharge - co kasa odrzuca przed zamówieniem", () => {
  it("kupon 100% (0), kwoty ujemne i nieliczbowe są poniżej minimum", () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isBelowMinimumCharge(amount, "PLN"), String(amount)).toBe(true);
    }
  });

  it("granica jest po stronie dozwolonej: 2,00 zł przechodzi, 1,99 zł nie", () => {
    expect(isBelowMinimumCharge(199, "PLN")).toBe(true);
    expect(isBelowMinimumCharge(200, "PLN")).toBe(false);
  });

  it("ta sama kwota w innej walucie ma inny próg: 50 centów euro przechodzi", () => {
    expect(isBelowMinimumCharge(50, "EUR")).toBe(false);
    expect(isBelowMinimumCharge(50, "PLN")).toBe(true);
  });
});
