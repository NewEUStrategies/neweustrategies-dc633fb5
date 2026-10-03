import { describe, it, expect } from "vitest";
import {
  computeDelta,
  formatCount,
  formatDecimal,
  formatDeltaPercent,
  formatMoneyCents,
  formatShare,
  rate,
} from "../compare";

describe("computeDelta - arytmetyka", () => {
  it("liczy różnicę bezwzględną i względną", () => {
    const d = computeDelta(150, 100);
    expect(d.absolute).toBe(50);
    expect(d.ratio).toBeCloseTo(0.5);
  });

  it("spadek ma ujemny stosunek", () => {
    expect(computeDelta(80, 100).ratio).toBeCloseTo(-0.2);
  });
});

describe("computeDelta - zero w odniesieniu", () => {
  // TO JEST SEDNO TEGO MODUŁU. Wzrost z zera nie jest wzrostem o 100% ani o ∞ -
  // jest wzrostem, dla którego procent NIE ISTNIEJE.
  it("nie wymyśla procentu, gdy poprzedni okres był pusty", () => {
    const d = computeDelta(42, 0);
    expect(d.ratio).toBeNull();
    expect(d.tone).toBe("unknown");
    expect(formatDeltaPercent(d, "pl")).toBeNull();
  });

  it("odróżnia zmierzone zero od braku odniesienia", () => {
    const d = computeDelta(0, 0);
    expect(d.ratio).toBe(0);
    expect(d.tone).toBe("flat");
  });
});

describe("computeDelta - biegunowość", () => {
  it("wzrost jest dobrą wiadomością tam, gdzie więcej znaczy lepiej", () => {
    expect(computeDelta(150, 100, "higher-better").tone).toBe("positive");
    expect(computeDelta(80, 100, "higher-better").tone).toBe("negative");
  });

  it("przy metryce odwróconej wzrost jest złą wiadomością", () => {
    // Wypisania z newslettera: ta sama strzałka w górę, przeciwna wymowa.
    expect(computeDelta(150, 100, "lower-better").tone).toBe("negative");
    expect(computeDelta(80, 100, "lower-better").tone).toBe("positive");
  });

  it("metryka neutralna nie dostaje oceny", () => {
    expect(computeDelta(150, 100, "neutral").tone).toBe("flat");
  });

  it("zmiana poniżej progu szumu jest płaska", () => {
    expect(computeDelta(1002, 1000).tone).toBe("flat");
    expect(computeDelta(1200, 1000).tone).toBe("positive");
  });
});

describe("formatDeltaPercent", () => {
  it("dokłada znak i przecinek dziesiętny po polsku", () => {
    expect(formatDeltaPercent(computeDelta(105, 100), "pl")).toBe("+5,0%");
    expect(formatDeltaPercent(computeDelta(105, 100), "en")).toBe("+5.0%");
  });

  it("powyżej dziesięciu procent rezygnuje z ułamka", () => {
    expect(formatDeltaPercent(computeDelta(150, 100), "pl")).toBe("+50%");
  });

  it("spadek dostaje minus", () => {
    expect(formatDeltaPercent(computeDelta(50, 100), "pl")).toBe("-50%");
  });
});

describe("rate", () => {
  it("zwraca ułamek", () => {
    expect(rate(25, 100)).toBeCloseTo(0.25);
  });

  it("pusty mianownik daje null, a nie zero", () => {
    expect(rate(0, 0)).toBeNull();
  });
});

// Separator dziesiętny jest decyzją o locale. Panele pulpitu sklejały wcześniej
// `toFixed` z "%", więc polski ekran mieszał „42.0%" z „12 345".
describe("formatShare / formatDecimal - locale, nie `toFixed`", () => {
  it("procent udziału z przecinkiem po polsku i kropką po angielsku", () => {
    expect(formatShare(0.42, "pl")).toBe("42,0%");
    expect(formatShare(0.42, "en")).toBe("42.0%");
  });

  it("liczba cyfr po przecinku jest parametrem, z jedną domyślnie", () => {
    expect(formatShare(0.4249, "pl", 0)).toBe("42%");
    expect(formatShare(0.04249, "pl", 1)).toBe("4,2%");
  });

  it("wartość ułamkowa nie traci zera po przecinku i idzie za językiem", () => {
    expect(formatDecimal(2.5, "pl")).toBe("2,5");
    expect(formatDecimal(2.5, "en")).toBe("2.5");
    expect(formatDecimal(3, "pl")).toBe("3,0");
  });
});

describe("formatCount / formatMoneyCents", () => {
  it("zaokrągla do całości i grupuje tysiące wg języka", () => {
    expect(formatCount(12345.6, "pl")).toBe("12 346");
    expect(formatCount(12345.6, "en")).toBe("12,346");
  });

  it("kwota w groszach to pełne jednostki waluty, bez groszy", () => {
    expect(formatMoneyCents(1_234_567, "PLN", "pl")).toBe("12 346 zł");
    expect(formatMoneyCents(1_234_567, "EUR", "en")).toBe("€12,346");
  });

  it("pusta waluta spada na PLN zamiast rzucić", () => {
    expect(formatMoneyCents(10_000, "", "pl")).toBe("100 zł");
  });
});
