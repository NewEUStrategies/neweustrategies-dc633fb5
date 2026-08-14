// Bramka: wskaźnik zaangażowania NIE przekracza 100%.
//
// To była twarz usterki - panel kampanii pokazujący „otwarcia: 137%". Test
// pilnuje obu połów poprawki: sufitu oraz odróżnienia „brak mianownika" od
// „zero otwarć" (kampania niewysłana to nie kampania zignorowana).
import { describe, expect, it } from "vitest";
import { engagementRate } from "../engagementRate";

describe("engagementRate", () => {
  it("liczy zwykły odsetek dostarczonych", () => {
    expect(engagementRate(25, 100)).toBe(25);
    expect(engagementRate(1, 3)).toBe(33);
    expect(engagementRate(2, 3)).toBe(67);
  });

  it("przycina do 100% - liczba wyższa nie jest zawyżona, tylko niemożliwa", () => {
    expect(engagementRate(137, 100)).toBe(100);
    expect(engagementRate(100, 100)).toBe(100);
    expect(engagementRate(1_000_000, 1)).toBe(100);
  });

  it("zwraca null bez mianownika - brak wysyłki to nie zerowe otwarcia", () => {
    expect(engagementRate(0, 0)).toBeNull();
    expect(engagementRate(12, 0)).toBeNull();
    expect(engagementRate(12, -5)).toBeNull();
  });

  it("odsiewa wartości nieliczbowe zamiast renderować NaN%", () => {
    expect(engagementRate(Number.NaN, 100)).toBeNull();
    expect(engagementRate(10, Number.NaN)).toBeNull();
    expect(engagementRate(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });

  it("ujemny zasięg czyta się jako zero, nie jako ujemny procent", () => {
    expect(engagementRate(-4, 100)).toBe(0);
  });
});
