// Parity słownika „Zapytanie do eksperta" (PL / EN). Trzymamy zbiór kluczy
// identyczny w obu językach, żeby żaden fallback do klucza-łańcucha nie
// przeciekł do UI.
import { describe, it, expect } from "vitest";
import { expertRequestPl, expertRequestEn } from "@/lib/i18n-expert-request";

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(...collectKeys(v, next));
  }
  return out;
}

describe("i18n-expert-request parity", () => {
  const plKeys = collectKeys(expertRequestPl).sort();
  const enKeys = collectKeys(expertRequestEn).sort();

  it("PL i EN mają dokładnie te same klucze", () => {
    expect(plKeys).toEqual(enKeys);
  });

  it("zawiera komunikaty o kwocie miesięcznej i bramce warstwy", () => {
    for (const key of [
      "expertRequest.error.monthlyQuota",
      "expertRequest.error.tierDisabled",
      "expertRequest.error.notExpert",
      "expertRequest.chatGate.tierDisabledToast",
      "expertRequest.chatGate.openPricing",
    ]) {
      expect(plKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it("ma komplet stanów puli (remaining/direct/none/exhausted) oraz etykiety CTA", () => {
    for (const key of [
      "expertRequest.quota.remaining",
      "expertRequest.quota.direct",
      "expertRequest.quota.none",
      "expertRequest.quota.exhausted",
    ]) {
      expect(plKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
    expect(expertRequestPl.expertRequest.cta).toBe("Zapytanie do eksperta");
    expect(expertRequestEn.expertRequest.cta).toBe("Expert request");
  });

  it("nie używa już nazwy inMail w kopii", () => {
    const allCopy = [
      ...Object.values(collectValues(expertRequestPl)),
      ...Object.values(collectValues(expertRequestEn)),
    ].join(" ");
    expect(allCopy.toLowerCase()).not.toContain("inmail");
  });
});

function collectValues(obj: unknown, prefix = "", acc: Record<string, string> = {}) {
  if (typeof obj === "string") {
    acc[prefix] = obj;
    return acc;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      collectValues(v, prefix ? `${prefix}.${k}` : k, acc);
    }
  }
  return acc;
}
