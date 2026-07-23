// Parity słownika inMail (PL / EN). Trzymamy zbiór kluczy identyczny w obu
// językach, żeby żaden fallback do klucza-łańcucha nie przeciekł do UI.
import { describe, it, expect } from "vitest";
import { inmailPl, inmailEn } from "@/lib/i18n-inmail";

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(...collectKeys(v, next));
  }
  return out;
}

describe("i18n-inmail parity", () => {
  const plKeys = collectKeys(inmailPl).sort();
  const enKeys = collectKeys(inmailEn).sort();

  it("PL i EN mają dokładnie te same klucze", () => {
    expect(plKeys).toEqual(enKeys);
  });

  it("zawiera nowe komunikaty o kwocie miesięcznej i bramce warstwy", () => {
    for (const key of [
      "inmail.error.monthlyQuota",
      "inmail.error.tierDisabled",
      "inmail.error.notExpert",
      "inmail.chatGate.tierDisabledToast",
      "inmail.chatGate.openPricing",
    ]) {
      expect(plKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it("kopia dialogu wprost wskazuje kwoty Plus/Pro i mechanizm inMail", () => {
    expect(inmailPl.inmail.dialogSubtitle).toMatch(/Plus.*2.*Pro.*5/i);
    expect(inmailEn.inmail.dialogSubtitle).toMatch(/Plus.*2.*Pro.*5/i);
  });
});
