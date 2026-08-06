import { describe, expect, it } from "vitest";
import {
  isValidVerificationDomain,
  normalizeDomainInput,
  parseSweepResult,
} from "@/lib/admin/verificationDomains";

describe("normalizeDomainInput", () => {
  it("obcina protokół, ścieżkę i część lokalną adresu", () => {
    expect(normalizeDomainInput("  https://NewEuropeanStrategies.com/team ")).toBe(
      "neweuropeanstrategies.com",
    );
    expect(normalizeDomainInput("m.dropinski@NewEUStrategies.com")).toBe("neweustrategies.com");
    expect(normalizeDomainInput("@firma.pl")).toBe("firma.pl");
    expect(normalizeDomainInput("firma.pl.")).toBe("firma.pl");
  });
});

describe("isValidVerificationDomain", () => {
  it("akceptuje poprawne domeny", () => {
    for (const domain of ["firma.pl", "new-eu.strategies.com", "a1.co"]) {
      expect(isValidVerificationDomain(domain)).toBe(true);
    }
  });

  it("odrzuca wpisy bez kropki, ze spacją lub z niedozwolonym znakiem", () => {
    for (const domain of ["", "localhost", "firma .pl", "-firma.pl", "firma.pl-", "firma@pl"]) {
      expect(isValidVerificationDomain(domain)).toBe(false);
    }
  });
});

describe("parseSweepResult", () => {
  it("czyta liczniki z odpowiedzi RPC", () => {
    expect(parseSweepResult({ checked: 49, granted: 49, revoked: 0 })).toEqual({
      checked: 49,
      granted: 49,
      revoked: 0,
    });
  });

  it("degraduje się bezpiecznie przy nietypowej odpowiedzi", () => {
    expect(parseSweepResult(null)).toEqual({ checked: 0, granted: 0, revoked: 0 });
    expect(parseSweepResult({ checked: "x" })).toEqual({ checked: 0, granted: 0, revoked: 0 });
  });
});
