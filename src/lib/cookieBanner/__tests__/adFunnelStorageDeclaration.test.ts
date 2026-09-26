// Deklaracja magazynu lejka Google Ads w rejestrze cookies.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. KLUCZ ATRYBUCJI (z identyfikatorem klikniecia) LADUJE W ZLEJ KATEGORII
//      banera - np. "analityczne" albo "niezbedne" - i uzytkownik zgadza sie na
//      cos innego, niz jest zapisywane.
//   2. KLUCZ ZMIENIA NAZWE w `storageKeys.ts`, a deklaracja zostaje przy starej -
//      skaner banera pokazuje go jako "wykryty automatycznie" bez opisu.
import { describe, expect, it } from "vitest";

import { classifyKey } from "@/lib/cookieBanner/registry";
import { AD_ATTRIBUTION_STORAGE_KEY, EVENT_FUNNEL_SENT_STORAGE_KEY } from "@/lib/storageKeys";

describe("rejestr cookies - magazyn lejka wydarzenia", () => {
  it("atrybucja kampanii to kategoria MARKETING, localStorage, 90 dni, opis PL/EN", () => {
    const entry = classifyKey(AD_ATTRIBUTION_STORAGE_KEY.key);
    expect(entry).toMatchObject({
      name: "nes.attribution.v1",
      category: "marketing",
      kind: "localStorage",
      ttl_pl: "90 dni",
      ttl_en: "90 days",
    });
    expect(entry?.purpose_pl).toMatch(/Google Ads/);
    expect(entry?.purpose_en).toMatch(/Google Ads/);
  });

  it("pamiec wyslanych krokow lejka to kategoria ANALITYCZNA, sessionStorage", () => {
    expect(classifyKey(EVENT_FUNNEL_SENT_STORAGE_KEY.key)).toMatchObject({
      name: "nes.event-funnel.sent",
      category: "analytics",
      kind: "sessionStorage",
    });
  });

  it("klucze nie maja nazw historycznych (nowe klucze, bez migracji)", () => {
    expect(AD_ATTRIBUTION_STORAGE_KEY.legacy).toEqual([]);
    expect(EVENT_FUNNEL_SENT_STORAGE_KEY.legacy).toEqual([]);
  });
});
