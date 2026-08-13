// Parser liczb dowodowych hero kariery - kontrakt dla atomu CareerStat.
import { describe, expect, it } from "vitest";
import { easeOutCubic, parseStatValue } from "@/lib/careers/stats";

describe("careers: parseStatValue", () => {
  it("czysta liczba - bez sufiksu", () => {
    expect(parseStatValue("45")).toEqual({ target: 45, suffix: "" });
  });

  it("procent i mnożnik - sufiks za liczbą", () => {
    expect(parseStatValue("100%")).toEqual({ target: 100, suffix: "%" });
    expect(parseStatValue("3x")).toEqual({ target: 3, suffix: "x" });
  });

  it("toleruje białe znaki wokół wartości", () => {
    expect(parseStatValue(" 9 ")).toEqual({ target: 9, suffix: "" });
  });

  it("wartość nienumeryczna wraca w całości jako sufiks (render statyczny)", () => {
    expect(parseStatValue("PL/EN")).toEqual({ target: null, suffix: "PL/EN" });
    expect(parseStatValue("")).toEqual({ target: null, suffix: "" });
  });
});

describe("careers: easeOutCubic", () => {
  it("zaczyna w 0, kończy w 1 i jest obcięty do [0,1]", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("po połowie czasu jest już za połową drogi (zwalnianie przy końcu)", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0.5)).toBeLessThan(1);
  });
});
