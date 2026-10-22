// Domyślne zgody RODO widżetów formularzy (kontakt, rejestracja) w rejestrze
// buildera wskazują ISTNIEJĄCĄ trasę polityki prywatności (I9, Z-I9d-19).
//
// PO CO. Angielski tekst domyślny prowadził do `/privacy-policy`, której
// nie ma - osoba, która chciała przeczytać, na co się zgadza, trafiała na
// 404. Trasa polityki jest jedna (`src/routes/polityka-prywatnosci.tsx`),
// wersja EN żyje pod prefiksem `/en` (jak w `newsletter/consentText.ts`).
// Rejestr czytamy jako tekst - import ciągnąłby cały katalog widżetów.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REGISTRY = readFileSync("src/lib/builder/registry.tsx", "utf8");

describe("rejestr buildera - linki domyślnych zgód RODO", () => {
  it("żaden tekst domyślny nie wskazuje nieistniejącej trasy /privacy-policy", () => {
    expect(REGISTRY).not.toContain("/privacy-policy");
  });

  it("zgody EN prowadzą do /en/polityka-prywatnosci, PL - do /polityka-prywatnosci", () => {
    const en = [...REGISTRY.matchAll(/\[Privacy Policy\]\(([^)]+)\)/g)].map((m) => m[1]);
    const pl = [...REGISTRY.matchAll(/\[Polityką prywatności\]\(([^)]+)\)/g)].map((m) => m[1]);
    expect(en.length).toBeGreaterThan(0);
    expect(new Set(en)).toEqual(new Set(["/en/polityka-prywatnosci"]));
    expect(new Set(pl)).toEqual(new Set(["/polityka-prywatnosci"]));
    expect(existsSync("src/routes/polityka-prywatnosci.tsx")).toBe(true);
  });
});
