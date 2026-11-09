// Polityka indeksowalności z kodu (`lib/seo/indexability.ts`) - jedno wejście
// rdzenia (kolektor mapy XML) do reguł domeny SEO.
import { describe, expect, it } from "vitest";
import { eventSlugExcludedFromIndex, pagePathExcludedFromIndex } from "@/lib/seo/indexability";

describe("pagePathExcludedFromIndex", () => {
  it("łączy trasy kodowe z `noindex` i strony techniczne CMS-a", () => {
    expect(pagePathExcludedFromIndex("login")).toBe(true);
    expect(pagePathExcludedFromIndex("club")).toBe(true);
    expect(pagePathExcludedFromIndex("customize-interests")).toBe(true);
    expect(pagePathExcludedFromIndex("moje-konto")).toBe(true);
  });

  it("zwykłe strony zostają indeksowalne", () => {
    expect(pagePathExcludedFromIndex("analizy")).toBe(false);
    expect(pagePathExcludedFromIndex("kontakt/login")).toBe(false);
    expect(pagePathExcludedFromIndex("spotkania-chatham-house")).toBe(false);
  });
});

describe("eventSlugExcludedFromIndex", () => {
  it("wydarzenie testowe wypada, treść o „testach” zostaje", () => {
    expect(eventSlugExcludedFromIndex("test-e2e-zakup")).toBe(true);
    expect(eventSlugExcludedFromIndex("e2e-rejestracja")).toBe(true);
    expect(eventSlugExcludedFromIndex("testy-nato-2026")).toBe(false);
    expect(eventSlugExcludedFromIndex(null)).toBe(false);
  });
});
