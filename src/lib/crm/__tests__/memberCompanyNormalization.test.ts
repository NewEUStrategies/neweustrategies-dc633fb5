// Dedup firm w CRM opiera się wyłącznie na normalizacji nazwy - jeżeli
// przestanie zbijać wariantów zapisu, katalog firm rozjedzie się na duplikaty.
import { describe, it, expect } from "vitest";
import { normalizeCompanyName } from "@/lib/crm/memberSync.server";

describe("normalizeCompanyName", () => {
  it("zbija warianty formy prawnej i interpunkcji do jednej postaci", () => {
    expect(normalizeCompanyName("Nowak Consulting Sp. z o.o.")).toBe("nowak consulting");
    expect(normalizeCompanyName("  NOWAK   Consulting ")).toBe("nowak consulting");
    expect(normalizeCompanyName("Nowak Consulting Ltd")).toBe("nowak consulting");
  });

  it("pusta lub sama forma prawna nie tworzy firmy", () => {
    expect(normalizeCompanyName("   ")).toBe("");
    expect(normalizeCompanyName("sp. z o.o.")).toBe("");
  });
});
